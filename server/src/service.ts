// Glue: sync sources, build the report, run the coach. Used by the HTTP server and the CLI.

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { activitiesBetween, readingsBetween, recordSync, upsertActivities, upsertReadings, type DB } from "./db.ts";
import { addDays, analyze } from "./rules.ts";
import { fetchUltrahuman } from "./sources/ultrahuman.ts";
import { fetchIntervals } from "./sources/intervals.ts";
import { coachReply, isApproval, lockPlan, type Athlete, type ChatTurn } from "./coach.ts";
import { renderWorkoutPdf } from "./pdf.ts";
import type { ReadinessReport, ThresholdTable } from "./types.ts";

const configPath = (name: string) => new URL(`../config/${name}`, import.meta.url);

export function loadThresholds(): ThresholdTable {
  return JSON.parse(readFileSync(configPath("thresholds.json"), "utf8")) as ThresholdTable;
}

export function loadAthlete(): Athlete {
  const own = configPath("athlete.json");
  return JSON.parse(readFileSync(existsSync(own) ? own : configPath("athlete.example.json"), "utf8")) as Athlete;
}

/** Pull every configured cloud source for the last `days` days. Missing credentials are skipped. */
export async function syncAll(db: DB, today: string, days = 3): Promise<string[]> {
  const log: string[] = [];
  const env = process.env;
  if (env.ULTRAHUMAN_TOKEN) {
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      try {
        const { readings } = await fetchUltrahuman(d, env.ULTRAHUMAN_TOKEN, env.ULTRAHUMAN_EMAIL);
        upsertReadings(db, readings);
        log.push(`ultrahuman ${d}: ${readings.length} readings`);
        recordSync(db, "ultrahuman");
      } catch (e) {
        recordSync(db, "ultrahuman", String(e));
        log.push(`ultrahuman ${d}: ${String(e)}`);
      }
    }
  }
  if (env.INTERVALS_ATHLETE_ID && env.INTERVALS_API_KEY) {
    try {
      const { readings, activities } = await fetchIntervals(
        env.INTERVALS_ATHLETE_ID, env.INTERVALS_API_KEY, addDays(today, -Math.max(days, 14)), today,
      );
      upsertReadings(db, readings);
      upsertActivities(db, activities);
      recordSync(db, "zepp");
      log.push(`intervals.icu: ${readings.length} readings, ${activities.length} activities`);
    } catch (e) {
      recordSync(db, "zepp", String(e));
      log.push(`intervals.icu: ${String(e)}`);
    }
  }
  return log;
}

export function buildReport(db: DB, date: string): ReadinessReport {
  const table = loadThresholds();
  const from = addDays(date, -(table.baselineDays + table.easyWeek.windowDays));
  return analyze(date, readingsBetween(db, from, date), table, { expectedSources: loadAthlete().expectedSources });
}

function history(db: DB, date: string): ChatTurn[] {
  return db.prepare(`SELECT role, content FROM messages WHERE date = ? ORDER BY id`).all(date) as unknown as ChatTurn[];
}

function save(db: DB, date: string, role: ChatTurn["role"], content: string) {
  db.prepare(`INSERT INTO messages (date, role, content) VALUES (?, ?, ?)`).run(date, role, content);
}

export async function morningCheckIn(db: DB, date: string): Promise<{ report: ReadinessReport; message: string }> {
  const report = buildReport(db, date);
  const recent = activitiesBetween(db, addDays(date, -14), date);
  const message = await coachReply(loadAthlete(), report, recent, []);
  save(db, date, "assistant", message);
  return { report, message };
}

/**
 * Quincy replies in chat. An explicit approval locks the plan and renders the PDF;
 * anything else continues the conversation.
 */
export async function handleMessage(
  db: DB,
  date: string,
  text: string,
  outDir = "out",
): Promise<{ message: string; pdfPath?: string }> {
  const athlete = loadAthlete();
  const report = buildReport(db, date);
  const recent = activitiesBetween(db, addDays(date, -14), date);
  save(db, date, "user", text);
  const turns = history(db, date);

  if (isApproval(text) && turns.some((t) => t.role === "assistant")) {
    const plan = await lockPlan(athlete, report, recent, turns);
    mkdirSync(outDir, { recursive: true });
    const pdfPath = await renderWorkoutPdf(plan, report, `${outDir}/flow-${date}.pdf`);
    db.prepare(`INSERT OR REPLACE INTO plans (date, status, plan_json, approved_at) VALUES (?, 'approved', ?, datetime('now'))`)
      .run(date, JSON.stringify(plan));
    const message = `Locked. ${plan.title}, ${plan.totalMinutes} min. PDF is ready.`;
    save(db, date, "assistant", message);
    return { message, pdfPath };
  }

  const message = await coachReply(athlete, report, recent, turns);
  save(db, date, "assistant", message);
  return { message };
}
