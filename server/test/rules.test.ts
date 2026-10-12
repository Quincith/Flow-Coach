import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, addDays } from "../src/rules.ts";
import { loadThresholds } from "../src/service.ts";
import { parseHealthPayload } from "../src/sources/healthkit.ts";
import { parseUltrahuman } from "../src/sources/ultrahuman.ts";
import { parseWellness } from "../src/sources/intervals.ts";
import { isApproval, noDashes } from "../src/coach.ts";
import { TODAY, sampleReadings } from "./fixtures/sample.ts";
import type { Reading } from "../src/types.ts";

const table = loadThresholds();
const opts = { expectedSources: ["ultrahuman", "zepp"] as const } as { expectedSources: ("ultrahuman" | "zepp")[] };

test("HRV under 55 is red on his table and caps the day", () => {
  const r = analyze(TODAY, sampleReadings(), table, opts);
  const hrv = r.verdicts.find((v) => v.metric === "hrv_rmssd_ms")!;
  assert.equal(hrv.band, "red");
  assert.equal(r.call, "cap");
});

test("calls out an app label that disagrees with his table", () => {
  const r = analyze(TODAY, sampleReadings(), table, opts);
  const hrv = r.verdicts.find((v) => v.metric === "hrv_rmssd_ms")!;
  assert.ok(hrv.notes.some((n) => n.includes('"Good"') && n.includes("red")), hrv.notes.join(" | "));
});

test("flags Zepp vs ring sleep disagreement and prefers the ring", () => {
  const r = analyze(TODAY, sampleReadings(), table, opts);
  const sleep = r.verdicts.find((v) => v.metric === "sleep_total_min")!;
  assert.equal(sleep.source, "ultrahuman");
  assert.ok(sleep.notes.some((n) => n.includes("disagree")));
});

test("reads a rising trend even while still red", () => {
  const r = analyze(TODAY, sampleReadings(), table, opts);
  assert.equal(r.verdicts.find((v) => v.metric === "hrv_rmssd_ms")!.trend, "rising");
  assert.ok(r.flags.some((f) => f.includes("climbing")));
});

test("multi-week red HRV recommends an easy week", () => {
  const r = analyze(TODAY, sampleReadings(), table, opts);
  assert.ok(r.flags.some((f) => f.includes("easy week")));
});

test("ring disconnect is flagged and Zepp-only data still scores", () => {
  const readings = sampleReadings().filter((x) => !(x.date === TODAY && x.source === "ultrahuman"));
  const r = analyze(TODAY, readings, table, opts);
  assert.deepEqual(r.missingSources, ["ultrahuman"]);
  assert.ok(r.flags[0].includes("Ultrahuman ring"));
  assert.equal(r.verdicts.find((v) => v.metric === "sleep_total_min")!.source, "zepp");
});

test("green day with healthy numbers is a go", () => {
  const readings: Reading[] = [];
  for (let i = 30; i >= 0; i--) {
    const date = addDays(TODAY, -i);
    readings.push({ date, source: "ultrahuman", metric: "hrv_rmssd_ms", value: 72 });
    readings.push({ date, source: "ultrahuman", metric: "resting_hr_bpm", value: 50 });
    readings.push({ date, source: "ultrahuman", metric: "sleep_total_min", value: 470 });
    readings.push({ date, source: "zepp", metric: "sleep_total_min", value: 465 });
  }
  const r = analyze(TODAY, readings, table, opts);
  assert.equal(r.call, "go");
  assert.equal(r.flags.length, 0);
});

test("Apple Health samples keep their originating app", () => {
  const rs = parseHealthPayload({
    platform: "ios",
    samples: [
      { date: TODAY, metric: "sleep_total_min", value: 400, origin: "Zepp" },
      { date: TODAY, metric: "sleep_total_min", value: 450, origin: "com.ultrahuman.android" },
      { date: TODAY, metric: "hrv_sdnn_ms", value: 60, origin: "Quincy's Apple Watch" },
    ],
  });
  assert.deepEqual(rs.map((r) => r.source), ["zepp", "ultrahuman", "apple_health"]);
});

test("Ultrahuman parser reads common shapes", () => {
  const rs = parseUltrahuman(TODAY, {
    data: { metric_data: [
      { type: "avg_sleep_hrv", object: { value: 48 } },
      { type: "night_rhr", object: { avg: 56 } },
      { type: "sleep", object: { total_sleep: { value: 25200 } } },
    ] },
  });
  const by = Object.fromEntries(rs.map((r) => [r.metric, r.value]));
  assert.equal(by.hrv_rmssd_ms, 48);
  assert.equal(by.resting_hr_bpm, 56);
  assert.equal(by.sleep_total_min, 420);
});

test("intervals.icu wellness maps to readings", () => {
  const rs = parseWellness([{ id: TODAY, restingHR: 55, hrv: 47, sleepSecs: 24000 }], "zepp");
  assert.equal(rs.length, 3);
  assert.equal(rs.find((r) => r.metric === "sleep_total_min")!.value, 400);
});

test("approval detection and dash stripping", () => {
  assert.ok(isApproval("Yes"));
  assert.ok(isApproval("lock it in"));
  assert.ok(!isApproval("can we swap the run for bike?"));
  assert.equal(noDashes("Go easy — HRV is red"), "Go easy, HRV is red");
});
