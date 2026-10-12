// The judgment layer. Code has already scored every reading (rules.ts); Claude turns that into
// the readiness read, the call and the plan, following Quincy's coaching rules.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { formatValue, sourceName } from "./rules.ts";
import type { Activity, ReadinessReport } from "./types.ts";

const MODEL = process.env.FLOW_MODEL ?? "claude-opus-5-5";
const client = new Anthropic();

export interface Athlete {
  name: string;
  timezone: string;
  expectedSources: ReadinessReport["missingSources"];
  goals: string[];
  weeklyFramework: Record<string, string>;
  injuries: string[];
  nonNegotiables: string[];
  equipment: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const rules = () => readFileSync(new URL("../config/coach-rules.md", import.meta.url), "utf8");

/** Compact, model-friendly rendering of the computed report. */
export function renderReport(r: ReadinessReport): string {
  const rows = r.verdicts.map((v) => {
    const val = v.value === null ? "missing" : formatValue(v.metric, v.value);
    const base = v.baseline === null ? "n/a" : formatValue(v.metric, v.baseline);
    const week = v.last7.map((x) => (x === null ? "-" : formatValue(v.metric, x))).join(", ");
    const src = v.source ? sourceName(v.source) : "none";
    return `| ${v.label} | ${val} | ${v.band ?? "n/a"} | ${base} | ${v.trend} | ${week} | ${src} | ${v.notes.join(" ") || ""} |`;
  });
  return [
    `Date: ${r.date}`,
    `Computed call: ${r.call.toUpperCase()} (${r.callReasons.join("; ")})`,
    "",
    "| Metric | Today | Band (his table) | 30d baseline | Trend | Last 7 days | Source | Notes |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "Flags:",
    ...(r.flags.length ? r.flags.map((f) => `- ${f}`) : ["- none"]),
  ].join("\n");
}

export function renderActivities(acts: Activity[]): string {
  if (acts.length === 0) return "No logged sessions in the window.";
  return acts
    .map((a) => {
      const zones = a.zoneMin ? ` zones(min) ${a.zoneMin.join("/")}` : "";
      const hr = a.avgHr ? ` avgHR ${Math.round(a.avgHr)}` : "";
      const load = a.trainingLoad ? ` load ${Math.round(a.trainingLoad)}` : "";
      const rpe = a.rpe ? ` RPE ${a.rpe}` : "";
      return `- ${a.date} ${a.type} ${a.durationMin}min${hr}${zones}${load}${rpe}${a.notes ? ` (${a.notes})` : ""}`;
    })
    .join("\n");
}

function context(athlete: Athlete, report: ReadinessReport, recent: Activity[], calendar?: string): string {
  const weekday = new Date(`${report.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return [
    `Athlete: ${athlete.name}. Today is ${weekday} ${report.date}.`,
    `Goals: ${athlete.goals.join("; ")}`,
    `Weekly framework: ${Object.entries(athlete.weeklyFramework).map(([d, s]) => `${d}: ${s}`).join(" | ")}`,
    `Injuries: ${athlete.injuries.join("; ") || "none listed"}`,
    `Non-negotiables: ${athlete.nonNegotiables.join("; ") || "none listed"}`,
    `Equipment: ${athlete.equipment.join(", ")}`,
    calendar ? `Calendar today:\n${calendar}` : "Calendar: not connected yet.",
    "",
    "## Readiness report (computed, authoritative)",
    renderReport(report),
    "",
    "## Last 14 days of training",
    renderActivities(recent),
  ].join("\n");
}

/** Strip any em/en dashes the model slips in; Quincy never wants them. */
export const noDashes = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

function textOf(msg: Anthropic.Message): string {
  if (msg.stop_reason === "refusal") throw new Error("Coach request was declined by the model.");
  return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

/** Morning check-in, or a reply in the day's conversation. */
export async function coachReply(
  athlete: Athlete,
  report: ReadinessReport,
  recent: Activity[],
  history: ChatTurn[],
  calendar?: string,
): Promise<string> {
  const opening: ChatTurn = {
    role: "user",
    content: `${context(athlete, report, recent, calendar)}\n\nGive this morning's readiness read, the call, and the proposed workout. Do not generate a PDF.`,
  };
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [{ type: "text", text: rules(), cache_control: { type: "ephemeral" } }],
    messages: [opening, ...history],
  });
  return noDashes(textOf(await stream.finalMessage()));
}

const Exercise = z.object({
  name: z.string(),
  sets: z.string().describe("e.g. '4' or '3-4'"),
  reps: z.string().describe("reps, time or distance, e.g. '3-5', '20s hold', '2x20m'"),
  load: z.string().describe("load or intensity, e.g. 'BW', '24kg', 'RPE 7'"),
  rest: z.string(),
  cue: z.string().describe("one short coaching cue, may be empty"),
});

export const WorkoutPlan = z.object({
  title: z.string().describe("e.g. 'Pull + Power, capped'"),
  call: z.enum(["go", "moderate", "cap"]),
  readinessSummary: z.string().describe("one line, e.g. 'HRV 48 red but rising, sleep 7h10 green, RHR yellow'"),
  why: z.array(z.string()).describe("2-3 short bullets: why this session today"),
  blocks: z.array(
    z.object({
      name: z.string().describe("Warm-up, Power, Strength, Skill, Conditioning, Cool-down"),
      format: z.string().describe("e.g. 'Straight sets', 'EMOM 12', '3 rounds', may be empty"),
      exercises: z.array(Exercise),
    }),
  ),
  totalMinutes: z.number(),
  scaleDown: z.string().describe("how to scale live if he feels worse than the data says"),
  tomorrow: z.string().describe("one line preview of tomorrow"),
});
export type WorkoutPlan = z.infer<typeof WorkoutPlan>;

/** After approval: turn the agreed workout from the conversation into the structured PDF payload. */
export async function lockPlan(
  athlete: Athlete,
  report: ReadinessReport,
  recent: Activity[],
  history: ChatTurn[],
): Promise<WorkoutPlan> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(WorkoutPlan) },
    system: [{ type: "text", text: rules(), cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: context(athlete, report, recent) },
      ...withFinalUser(history, "Approved. Output the exact workout we agreed on as structured data for the PDF. No changes."),
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Could not structure the approved plan.");
  return res.parsed_output;
}

/** Append an instruction to the last user turn (or add one) so roles keep alternating. */
function withFinalUser(history: ChatTurn[], text: string): ChatTurn[] {
  const last = history.at(-1);
  if (last?.role === "user") return [...history.slice(0, -1), { role: "user", content: `${last.content}\n\n${text}` }];
  return [...history, { role: "user", content: text }];
}

const APPROVAL = /^\s*(yes|yep|yeah|lock it in|locked|approved?|let'?s go|send it|do it|good to go)\b/i;
export const isApproval = (text: string) => APPROVAL.test(text);
