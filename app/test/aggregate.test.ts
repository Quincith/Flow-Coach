import { test } from "node:test";
import assert from "node:assert/strict";
import { nightOf, overnightAverage, sleepNights } from "../src/aggregate.ts";

const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`);

test("sleep that starts before midnight belongs to the wake-up day", () => {
  assert.equal(nightOf(at("2026-10-11", "23:30")), "2026-10-12");
  assert.equal(nightOf(at("2026-10-12", "06:40")), "2026-10-12");
});

test("sleep is totalled per night per app, excluding awake and in-bed", () => {
  const rows = sleepNights([
    { start: at("2026-10-11", "23:00"), end: at("2026-10-12", "02:00"), stage: "core", origin: "Zepp" },
    { start: at("2026-10-12", "02:00"), end: at("2026-10-12", "02:20"), stage: "awake", origin: "Zepp" },
    { start: at("2026-10-12", "02:20"), end: at("2026-10-12", "03:20"), stage: "deep", origin: "Zepp" },
    { start: at("2026-10-11", "22:50"), end: at("2026-10-12", "06:50"), stage: "asleep", origin: "Ultrahuman" },
    { start: at("2026-10-11", "22:40"), end: at("2026-10-12", "07:00"), stage: "inBed", origin: "Ultrahuman" },
  ]);
  const get = (origin: string, metric: string) => rows.find((r) => r.origin === origin && r.metric === metric)?.value;
  assert.equal(get("Zepp", "sleep_total_min"), 240);
  assert.equal(get("Zepp", "sleep_deep_min"), 60);
  assert.equal(get("Ultrahuman", "sleep_total_min"), 480);
});

test("overnight HRV ignores daytime samples", () => {
  const rows = overnightAverage(
    [
      { start: at("2026-10-12", "02:00"), end: at("2026-10-12", "02:01"), value: 40, origin: "Ultrahuman" },
      { start: at("2026-10-12", "04:00"), end: at("2026-10-12", "04:01"), value: 50, origin: "Ultrahuman" },
      { start: at("2026-10-12", "15:00"), end: at("2026-10-12", "15:01"), value: 90, origin: "Ultrahuman" },
    ],
    "hrv_sdnn_ms",
  );
  assert.deepEqual(rows, [{ date: "2026-10-12", origin: "Ultrahuman", metric: "hrv_sdnn_ms", value: 45 }]);
});
