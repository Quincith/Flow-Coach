// Ultrahuman ring via the personal API token (vision.ultrahuman.com/developer).
// Response shape: { data: { metric_data: [{ type, object }] } }. The inner `object` differs per
// type and is only partly documented publicly, so parsing is defensive: prefer an explicit
// average/value, fall back to the mean of a `values` series. Verify against a live response
// once a token is available (run `npm run morning -- --dump-ultrahuman`).

import type { Reading } from "../types.ts";

const BASE = process.env.ULTRAHUMAN_BASE_URL ?? "https://partner.ultrahuman.com/api/v1";

interface MetricBlock {
  type: string;
  object?: Record<string, unknown>;
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function summarize(obj: Record<string, unknown> | undefined): number | null {
  if (!obj) return null;
  const direct = num(obj.avg) ?? num(obj.value) ?? num(obj.average);
  if (direct !== null) return direct;
  const values = Array.isArray(obj.values) ? obj.values : [];
  const nums = values.map((v) => num((v as Record<string, unknown>)?.value)).filter((v): v is number => v !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** Sleep minutes can live under a few keys depending on API version; seconds are converted. */
function sleepMinutes(obj: Record<string, unknown> | undefined, key: string): number | null {
  if (!obj) return null;
  const node = obj[key] as Record<string, unknown> | number | undefined;
  const raw = typeof node === "number" ? node : num(node?.value);
  if (raw === null) return null;
  return raw > 1440 ? raw / 60 : raw; // seconds vs minutes
}

export function parseUltrahuman(date: string, body: unknown): Reading[] {
  const blocks = ((body as { data?: { metric_data?: MetricBlock[] } })?.data?.metric_data ?? []) as MetricBlock[];
  const out: Reading[] = [];
  const push = (metric: Reading["metric"], value: number | null) => {
    if (value !== null) out.push({ date, source: "ultrahuman", metric, value });
  };
  for (const b of blocks) {
    switch (b.type) {
      case "avg_sleep_hrv":
        push("hrv_rmssd_ms", summarize(b.object));
        break;
      case "night_rhr":
        push("resting_hr_bpm", summarize(b.object));
        break;
      case "temp":
        // Absolute skin temp is not useful on its own; the deviation is computed from baseline later.
        break;
      case "steps":
        push("steps", num(b.object?.total) ?? summarize(b.object));
        break;
      case "vo2_max":
        push("vo2max", summarize(b.object));
        break;
      case "sleep": {
        push("sleep_total_min", sleepMinutes(b.object, "total_sleep"));
        push("sleep_deep_min", sleepMinutes(b.object, "deep_sleep"));
        push("sleep_rem_min", sleepMinutes(b.object, "rem_sleep"));
        break;
      }
    }
  }
  // If the dedicated sleep HRV type is absent, fall back to the all-day HRV series.
  if (!out.some((r) => r.metric === "hrv_rmssd_ms")) {
    push("hrv_rmssd_ms", summarize(blocks.find((b) => b.type === "hrv")?.object));
  }
  return out;
}

export async function fetchUltrahuman(date: string, token: string, email?: string): Promise<{ readings: Reading[]; raw: unknown }> {
  const url = new URL(`${BASE}/metrics`);
  url.searchParams.set("date", date);
  if (email) url.searchParams.set("email", email);
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`Ultrahuman ${res.status}: ${await res.text()}`);
  const raw = await res.json();
  return { readings: parseUltrahuman(date, raw), raw };
}
