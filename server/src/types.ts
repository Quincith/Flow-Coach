// Shared types for readings, thresholds and the daily readiness analysis.

/** Where a reading came from. One device can reach us by more than one lane. */
export type Source =
  | "ultrahuman"
  | "zepp"
  | "apple_health"
  | "health_connect"
  | "garmin"
  | "oura"
  | "whoop"
  | "polar"
  | "fitbit"
  | "manual";

/** Normalized metric names. HRV is split by method because RMSSD and SDNN are not comparable. */
export type Metric =
  | "hrv_rmssd_ms"
  | "hrv_sdnn_ms"
  | "resting_hr_bpm"
  | "sleep_total_min"
  | "sleep_deep_min"
  | "sleep_rem_min"
  | "skin_temp_dev_c"
  | "respiratory_rate"
  | "spo2_pct"
  | "steps"
  | "vo2max";

export interface Reading {
  /** Calendar day the reading belongs to (the morning you wake up), YYYY-MM-DD. */
  date: string;
  source: Source;
  metric: Metric;
  value: number;
  /** The label the vendor app put on this number, if the source exposes one ("Good", "Optimal"). */
  appLabel?: string;
}

export interface Activity {
  id: string;
  source: Source;
  date: string;
  type: string;
  durationMin: number;
  avgHr?: number;
  maxHr?: number;
  /** Minutes in HR zones 1..5, when the source provides them. */
  zoneMin?: number[];
  trainingLoad?: number;
  rpe?: number;
  notes?: string;
}

export type Band = "green" | "yellow" | "red";

/**
 * One row of the threshold table. A reading is scored on two checks and the worse one wins:
 *  - absolute: fixed lines (e.g. HRV red under 55 ms)
 *  - baseline: percent or absolute change against the 30 day personal average
 */
export interface ThresholdRule {
  metric: Metric;
  label: string;
  higherIsBetter: boolean;
  absolute?: { green: number; red: number };
  baseline?: { kind: "pct" | "abs"; yellow: number; red: number };
  /** Which source to trust first when several report this metric. */
  preferredSources: Source[];
  /** Two sources further apart than this get called out. */
  divergenceLimit?: number;
}

export interface ThresholdTable {
  version: string;
  baselineDays: number;
  rules: ThresholdRule[];
  /** Days of red HRV in the trend window that trigger an easy-week recommendation. */
  easyWeek: { windowDays: number; redDays: number };
}

export interface MetricVerdict {
  metric: Metric;
  label: string;
  value: number | null;
  source: Source | null;
  band: Band | null;
  baseline: number | null;
  deltaFromBaseline: number | null;
  /** Last 7 primary values, oldest first, nulls for missing days. */
  last7: (number | null)[];
  trend: "rising" | "falling" | "flat" | "unknown";
  notes: string[];
}

export type Call = "go" | "moderate" | "cap";

export interface ReadinessReport {
  date: string;
  call: Call;
  callReasons: string[];
  verdicts: MetricVerdict[];
  missingSources: Source[];
  flags: string[];
}
