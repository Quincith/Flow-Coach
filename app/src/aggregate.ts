// Pure aggregation of Apple Health samples into one value per night, per metric, per source app.
// No React Native imports so it runs under plain Node tests.

export type Metric =
  | "hrv_sdnn_ms"
  | "resting_hr_bpm"
  | "sleep_total_min"
  | "sleep_deep_min"
  | "sleep_rem_min"
  | "respiratory_rate"
  | "spo2_pct"
  | "steps";

export interface RawSample {
  start: Date;
  end: Date;
  value: number;
  /** Source app name or bundle id from HealthKit, e.g. "Zepp", "com.ultrahuman.ios". */
  origin: string;
}

export type SleepStage = "inBed" | "asleep" | "awake" | "core" | "deep" | "rem";

export interface SleepSample {
  start: Date;
  end: Date;
  stage: SleepStage;
  origin: string;
}

export interface DaySample {
  date: string;
  metric: Metric;
  value: number;
  origin: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A sleep or overnight sample belongs to the morning you wake up. Anything ending after 6pm counts toward the next day. */
export function nightOf(end: Date): string {
  if (end.getHours() < 18) return localDate(end);
  const next = new Date(end);
  next.setDate(next.getDate() + 1);
  return localDate(next);
}

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Overnight averages (HRV, breathing rate, SpO2): samples that end between 6pm and noon. */
export function overnightAverage(samples: RawSample[], metric: Metric): DaySample[] {
  const night = samples.filter((s) => s.end.getHours() >= 18 || s.end.getHours() < 12);
  return [...group(night, (s) => `${nightOf(s.end)}|${s.origin}`)].map(([k, xs]) => {
    const [date, origin] = k.split("|");
    return { date, origin, metric, value: mean(xs.map((x) => x.value)) };
  });
}

/** Daily values reported once a day (resting HR): average per calendar day. */
export function dailyAverage(samples: RawSample[], metric: Metric): DaySample[] {
  return [...group(samples, (s) => `${localDate(s.start)}|${s.origin}`)].map(([k, xs]) => {
    const [date, origin] = k.split("|");
    return { date, origin, metric, value: mean(xs.map((x) => x.value)) };
  });
}

/** Cumulative values (steps): sum per calendar day. */
export function dailySum(samples: RawSample[], metric: Metric): DaySample[] {
  return [...group(samples, (s) => `${localDate(s.start)}|${s.origin}`)].map(([k, xs]) => {
    const [date, origin] = k.split("|");
    return { date, origin, metric, value: xs.reduce((a, x) => a + x.value, 0) };
  });
}

const minutes = (s: SleepSample) => (s.end.getTime() - s.start.getTime()) / 60000;

/**
 * Sleep per night per app. Total = all asleep stages (not in-bed, not awake).
 * Kept per app so Zepp and the ring stay separate and their disagreement stays visible.
 */
export function sleepNights(samples: SleepSample[]): DaySample[] {
  const out: DaySample[] = [];
  for (const [k, xs] of group(samples, (s) => `${nightOf(s.end)}|${s.origin}`)) {
    const [date, origin] = k.split("|");
    const sum = (stages: SleepStage[]) => xs.filter((x) => stages.includes(x.stage)).reduce((a, x) => a + minutes(x), 0);
    const total = sum(["asleep", "core", "deep", "rem"]);
    if (total > 0) out.push({ date, origin, metric: "sleep_total_min", value: Math.round(total) });
    const deep = sum(["deep"]);
    if (deep > 0) out.push({ date, origin, metric: "sleep_deep_min", value: Math.round(deep) });
    const rem = sum(["rem"]);
    if (rem > 0) out.push({ date, origin, metric: "sleep_rem_min", value: Math.round(rem) });
  }
  return out;
}
