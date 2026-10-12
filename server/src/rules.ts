// Deterministic readiness scoring. No LLM here: every band, discrepancy and trend is computed
// so the coach can never repeat a vendor's "Good" label on a number that is red on Quincy's table.

import type {
  Band, Call, Metric, MetricVerdict, Reading, ReadinessReport, Source, ThresholdRule, ThresholdTable,
} from "./types.ts";

const POSITIVE_LABELS = /^(good|optimal|excellent|high|normal|great|balanced|ready|fair)$/i;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatValue(metric: Metric, v: number): string {
  if (metric.startsWith("sleep_")) {
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return `${h}h${String(m).padStart(2, "0")}`;
  }
  if (metric === "skin_temp_dev_c") return `${v > 0 ? "+" : ""}${v.toFixed(1)}°C`;
  if (metric.startsWith("hrv_")) return `${Math.round(v)} ms`;
  if (metric === "resting_hr_bpm") return `${Math.round(v)} bpm`;
  return String(Math.round(v * 10) / 10);
}

const SOURCE_NAMES: Record<Source, string> = {
  ultrahuman: "Ultrahuman ring", zepp: "Zepp", apple_health: "Apple Health", health_connect: "Health Connect",
  garmin: "Garmin", oura: "Oura", whoop: "Whoop", polar: "Polar", fitbit: "Fitbit", manual: "Manual",
};
export const sourceName = (s: Source) => SOURCE_NAMES[s];

const worse = (a: Band, b: Band): Band => (a === "red" || b === "red" ? "red" : a === "yellow" || b === "yellow" ? "yellow" : "green");

/** Pick the most trusted source's value for one metric on one day. */
function primary(rule: ThresholdRule, dayReadings: Reading[]): Reading | null {
  const forMetric = dayReadings.filter((r) => r.metric === rule.metric);
  if (forMetric.length === 0) return null;
  for (const s of rule.preferredSources) {
    const hit = forMetric.find((r) => r.source === s);
    if (hit) return hit;
  }
  return forMetric[0];
}

function absoluteBand(rule: ThresholdRule, raw: number): Band | null {
  if (!rule.absolute) return null;
  // Temperature deviation is bad in either direction.
  const v = rule.metric === "skin_temp_dev_c" ? Math.abs(raw) : raw;
  const { green, red } = rule.absolute;
  if (rule.higherIsBetter) return v >= green ? "green" : v < red ? "red" : "yellow";
  return v <= green ? "green" : v > red ? "red" : "yellow";
}

function baselineBand(rule: ThresholdRule, v: number, baseline: number | null): Band | null {
  if (!rule.baseline || baseline === null) return null;
  const { kind, yellow, red } = rule.baseline;
  // Positive "bad" means moved in the wrong direction.
  const diff = rule.higherIsBetter ? baseline - v : v - baseline;
  const bad = kind === "pct" ? (diff / baseline) * 100 : diff;
  return bad >= red ? "red" : bad >= yellow ? "yellow" : "green";
}

function trendOf(values: (number | null)[]): MetricVerdict["trend"] {
  const recent = values.slice(-3).filter((v): v is number => v !== null);
  const prior = values.slice(0, -3).filter((v): v is number => v !== null);
  if (recent.length < 2 || prior.length < 2) return "unknown";
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const change = (avg(recent) - avg(prior)) / Math.abs(avg(prior) || 1);
  return change > 0.05 ? "rising" : change < -0.05 ? "falling" : "flat";
}

function bandFor(rule: ThresholdRule, v: number, baseline: number | null): Band | null {
  const a = absoluteBand(rule, v);
  const b = baselineBand(rule, v, baseline);
  if (a && b) return worse(a, b);
  return a ?? b;
}

export interface AnalyzeOptions {
  /** Sources Quincy normally wears overnight; a gap gets called out. */
  expectedSources: Source[];
}

export function analyze(
  date: string,
  readings: Reading[],
  table: ThresholdTable,
  opts: AnalyzeOptions,
): ReadinessReport {
  const byDate = new Map<string, Reading[]>();
  for (const r of readings) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const today = byDate.get(date) ?? [];
  const primaryOn = (rule: ThresholdRule, d: string) => primary(rule, byDate.get(d) ?? [])?.value ?? null;

  const verdicts: MetricVerdict[] = [];
  for (const rule of table.rules) {
    const p = primary(rule, today);
    const history: number[] = [];
    for (let i = table.baselineDays; i >= 1; i--) {
      const v = primaryOn(rule, addDays(date, -i));
      if (v !== null) history.push(v);
    }
    const baseline = history.length >= 7 ? history.reduce((a, b) => a + b, 0) / history.length : null;
    const last7: (number | null)[] = [];
    for (let i = 6; i >= 0; i--) last7.push(primaryOn(rule, addDays(date, -i)));

    const notes: string[] = [];
    let band: Band | null = null;
    if (p) {
      band = bandFor(rule, p.value, baseline);
      const others = today.filter((r) => r.metric === rule.metric && r.source !== p.source);
      for (const o of others) {
        if (rule.divergenceLimit !== undefined && Math.abs(o.value - p.value) > rule.divergenceLimit) {
          notes.push(
            `${sourceName(p.source)} ${formatValue(rule.metric, p.value)} vs ${sourceName(o.source)} ${formatValue(rule.metric, o.value)}. Sources disagree; using ${sourceName(p.source)}.`,
          );
        }
      }
      for (const r of today.filter((x) => x.metric === rule.metric && x.appLabel)) {
        const own = bandFor(rule, r.value, baseline);
        if (own && own !== "green" && POSITIVE_LABELS.test(r.appLabel!)) {
          notes.push(`${sourceName(r.source)} labels ${formatValue(rule.metric, r.value)} "${r.appLabel}", your table says ${own}.`);
        }
      }
    }
    if (!p && history.length === 0) continue; // metric never reported; keep the report short

    verdicts.push({
      metric: rule.metric,
      label: rule.label,
      value: p?.value ?? null,
      source: p?.source ?? null,
      band,
      baseline,
      deltaFromBaseline: p && baseline !== null ? p.value - baseline : null,
      last7,
      trend: trendOf(last7),
      notes,
    });
  }

  const presentSources = new Set(today.map((r) => r.source));
  const missingSources = opts.expectedSources.filter((s) => !presentSources.has(s));

  const flags: string[] = [];
  for (const s of missingSources) {
    const fallback = [...presentSources].map(sourceName).join(", ") || "nothing";
    flags.push(`No ${sourceName(s)} data for last night (disconnected or not synced). Working from ${fallback}.`);
  }

  const hrv = verdicts.find((v) => v.metric === "hrv_rmssd_ms") ?? verdicts.find((v) => v.metric === "hrv_sdnn_ms");
  if (hrv && hrv.band === "red" && hrv.trend === "rising") {
    flags.push(`${hrv.label} still red but climbing over the week (${hrv.last7.filter((v) => v !== null).map((v) => Math.round(v!)).join(" > ")}). Real rebound.`);
  }

  // Multi-week pattern: HRV red most days in the window means one-off scaled days are not working.
  const hrvRule = table.rules.find((r) => r.metric === (hrv?.metric ?? "hrv_rmssd_ms"));
  if (hrvRule) {
    let redDays = 0;
    let seen = 0;
    for (let i = table.easyWeek.windowDays - 1; i >= 0; i--) {
      const d = addDays(date, -i);
      const v = primaryOn(hrvRule, d);
      if (v === null) continue;
      seen++;
      const hist: number[] = [];
      for (let j = table.baselineDays; j >= 1; j--) {
        const h = primaryOn(hrvRule, addDays(d, -j));
        if (h !== null) hist.push(h);
      }
      const base = hist.length >= 7 ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
      if (bandFor(hrvRule, v, base) === "red") redDays++;
    }
    if (redDays >= table.easyWeek.redDays) {
      flags.push(
        `HRV red on ${redDays} of the last ${seen} days. Single scaled days are not clearing it. Recommend a planned easy week.`,
      );
    }
  }

  const reds = verdicts.filter((v) => v.band === "red");
  const yellows = verdicts.filter((v) => v.band === "yellow");
  const callReasons: string[] = [];
  let call: Call = "go";
  if ((hrv && hrv.band === "red") || reds.length >= 2) {
    call = "cap";
    callReasons.push(...reds.map((v) => `${v.label} red (${formatValue(v.metric, v.value!)})`));
  } else if (reds.length === 1 || yellows.length >= 2) {
    call = "moderate";
    callReasons.push(...[...reds, ...yellows].map((v) => `${v.label} ${v.band} (${formatValue(v.metric, v.value!)})`));
  } else {
    callReasons.push("No reds, at most one yellow.");
  }
  if (!hrv || hrv.value === null) flags.push("No HRV for last night. Readiness call is based on sleep and resting HR only.");

  return { date, call, callReasons, verdicts, missingSources, flags };
}
