// Reads Apple Health and posts per-night aggregates to the Flow Coach server.
// Every app that writes to Health (Zepp, Ultrahuman, Oura, Garmin, Whoop, Apple Watch...) is covered.

import {
  CategoryValueSleepAnalysis,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";
import { dailyAverage, dailySum, overnightAverage, sleepNights, type DaySample, type RawSample, type SleepStage } from "./aggregate";
import { postHealth } from "./api";

const READ = [
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierRespiratoryRate",
  "HKQuantityTypeIdentifierOxygenSaturation",
  "HKQuantityTypeIdentifierStepCount",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKWorkoutTypeIdentifier",
] as const;

export async function authorize(): Promise<boolean> {
  return requestAuthorization({ toRead: READ as unknown as Parameters<typeof requestAuthorization>[0]["toRead"] });
}

const STAGES: Record<number, SleepStage> = {
  [CategoryValueSleepAnalysis.inBed]: "inBed",
  [CategoryValueSleepAnalysis.asleepUnspecified]: "asleep",
  [CategoryValueSleepAnalysis.awake]: "awake",
  [CategoryValueSleepAnalysis.asleepCore]: "core",
  [CategoryValueSleepAnalysis.asleepDeep]: "deep",
  [CategoryValueSleepAnalysis.asleepREM]: "rem",
};

const origin = (s: { sourceRevision: { source: { name: string; bundleIdentifier: string } } }) =>
  `${s.sourceRevision.source.name} (${s.sourceRevision.source.bundleIdentifier})`;

async function quantity(id: (typeof READ)[number], unit: string, since: Date): Promise<RawSample[]> {
  const rows = await queryQuantitySamples(id as never, {
    limit: 0,
    unit: unit as never,
    filter: { date: { startDate: since } },
  });
  return rows.map((r) => ({ start: r.startDate, end: r.endDate, value: r.quantity, origin: origin(r) }));
}

/** Read the last `days` days and send them. Safe to repeat: the server upserts by day + source + metric. */
export async function syncHealth(days = 3): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(12, 0, 0, 0);

  const [hrv, rhr, resp, spo2, steps, sleep] = await Promise.all([
    quantity("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "ms", since),
    quantity("HKQuantityTypeIdentifierRestingHeartRate", "count/min", since),
    quantity("HKQuantityTypeIdentifierRespiratoryRate", "count/min", since),
    quantity("HKQuantityTypeIdentifierOxygenSaturation", "%", since),
    quantity("HKQuantityTypeIdentifierStepCount", "count", since),
    queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", { limit: 0, filter: { date: { startDate: since } } }),
  ]);

  const samples: DaySample[] = [
    ...overnightAverage(hrv, "hrv_sdnn_ms"),
    ...dailyAverage(rhr, "resting_hr_bpm"),
    ...overnightAverage(resp, "respiratory_rate"),
    ...overnightAverage(spo2.map((s) => ({ ...s, value: s.value <= 1 ? s.value * 100 : s.value })), "spo2_pct"),
    ...dailySum(steps, "steps"),
    ...sleepNights(
      sleep.map((s) => ({ start: s.startDate, end: s.endDate, stage: STAGES[s.value as number] ?? "asleep", origin: origin(s) })),
    ),
  ];
  await postHealth({ platform: "ios", samples });
  return samples.length;
}
