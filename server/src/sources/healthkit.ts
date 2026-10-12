// Payload the iPhone app posts after reading Apple Health (or Health Connect on Android).
// The app aggregates per day per originating app, so Zepp and the ring stay separate even
// though both arrive through Apple Health. That keeps the sleep disagreement visible.

import type { Metric, Reading, Source } from "../types.ts";

export interface HealthDaySample {
  date: string;
  metric: Metric;
  value: number;
  /** HealthKit source name / bundle id, e.g. "Zepp", "com.huami.watch", "Ultrahuman". */
  origin: string;
}

export interface HealthPayload {
  platform: "ios" | "android";
  samples: HealthDaySample[];
}

const ORIGINS: [RegExp, Source][] = [
  [/zepp|huami|amazfit/i, "zepp"],
  [/ultrahuman/i, "ultrahuman"],
  [/oura/i, "oura"],
  [/whoop/i, "whoop"],
  [/garmin/i, "garmin"],
  [/polar/i, "polar"],
  [/fitbit/i, "fitbit"],
];

export function originToSource(origin: string, platform: HealthPayload["platform"]): Source {
  for (const [re, s] of ORIGINS) if (re.test(origin)) return s;
  return platform === "ios" ? "apple_health" : "health_connect";
}

export function parseHealthPayload(p: HealthPayload): Reading[] {
  return p.samples
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Number.isFinite(s.value))
    .map((s) => ({ date: s.date, metric: s.metric, value: s.value, source: originToSource(s.origin, p.platform) }));
}
