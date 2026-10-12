// intervals.icu: free, and it links to Zepp/Amazfit, Garmin, Oura, Whoop, Polar, Suunto, Coros.
// We read wellness (sleep, RHR, HRV) and activities through its API with a personal key.
// Docs: https://intervals.icu/api-docs.html  Auth: basic, user "API_KEY", password = key.
// Known issue: Zepp HRV has been reported landing one day early, so rules.ts cross-checks HRV
// against the ring when both are present.

import type { Activity, Reading, Source } from "../types.ts";

const BASE = "https://intervals.icu/api/v1";

interface Wellness {
  id: string; // YYYY-MM-DD
  restingHR?: number | null;
  hrv?: number | null; // rMSSD
  hrvSDNN?: number | null;
  sleepSecs?: number | null;
  spO2?: number | null;
  respiration?: number | null;
  steps?: number | null;
  vo2max?: number | null;
}

interface IcuActivity {
  id: string | number;
  start_date_local: string;
  type?: string;
  moving_time?: number;
  elapsed_time?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  icu_training_load?: number | null;
  icu_hr_zone_times?: number[] | null;
  perceived_exertion?: number | null;
  icu_rpe?: number | null;
  name?: string;
}

export function parseWellness(rows: Wellness[], source: Source): Reading[] {
  const out: Reading[] = [];
  for (const w of rows) {
    const add = (metric: Reading["metric"], v: number | null | undefined) => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out.push({ date: w.id, source, metric, value: v });
    };
    add("resting_hr_bpm", w.restingHR);
    add("hrv_rmssd_ms", w.hrv);
    add("hrv_sdnn_ms", w.hrvSDNN);
    add("sleep_total_min", w.sleepSecs ? w.sleepSecs / 60 : null);
    add("spo2_pct", w.spO2);
    add("respiratory_rate", w.respiration);
    add("steps", w.steps);
    add("vo2max", w.vo2max);
  }
  return out;
}

export function parseActivities(rows: IcuActivity[], source: Source): Activity[] {
  return rows.map((a) => ({
    id: `icu-${a.id}`,
    source,
    date: a.start_date_local.slice(0, 10),
    type: a.type ?? "Workout",
    durationMin: Math.round((a.moving_time ?? a.elapsed_time ?? 0) / 60),
    avgHr: a.average_heartrate ?? undefined,
    maxHr: a.max_heartrate ?? undefined,
    zoneMin: a.icu_hr_zone_times?.map((s) => Math.round(s / 60)),
    trainingLoad: a.icu_training_load ?? undefined,
    rpe: a.icu_rpe ?? a.perceived_exertion ?? undefined,
    notes: a.name,
  }));
}

export async function fetchIntervals(
  athleteId: string,
  apiKey: string,
  oldest: string,
  newest: string,
  source: Source = "zepp",
): Promise<{ readings: Reading[]; activities: Activity[] }> {
  const auth = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${BASE}/athlete/${athleteId}/${path}?oldest=${oldest}&newest=${newest}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) throw new Error(`intervals.icu ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  };
  const [wellness, activities] = await Promise.all([get<Wellness[]>("wellness"), get<IcuActivity[]>("activities")]);
  return { readings: parseWellness(wellness, source), activities: parseActivities(activities, source) };
}
