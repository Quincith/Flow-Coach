// Synthetic history shaped like Quincy's described pattern: HRV stuck red for weeks, then a
// rebound (30 > 41 > 47), Zepp and ring disagreeing on sleep, a Tuesday run club.
import type { Activity, Reading } from "../../src/types.ts";
import { addDays } from "../../src/rules.ts";

export const TODAY = "2026-10-12";

export function sampleReadings(): Reading[] {
  const out: Reading[] = [];
  for (let i = 44; i >= 0; i--) {
    const date = addDays(TODAY, -i);
    const wobble = Math.sin(i * 1.7) * 3;
    const hrv = i > 6 ? 52 + wobble : [30, 34, 36, 41, 44, 47, 49][6 - i];
    out.push({ date, source: "ultrahuman", metric: "hrv_rmssd_ms", value: hrv });
    out.push({ date, source: "ultrahuman", metric: "resting_hr_bpm", value: 54 + Math.round(wobble / 2) + (i <= 2 ? 4 : 0) });
    out.push({ date, source: "ultrahuman", metric: "sleep_total_min", value: 430 + wobble * 8 });
    out.push({ date, source: "ultrahuman", metric: "sleep_deep_min", value: 70 + wobble * 2 });
    out.push({ date, source: "zepp", metric: "sleep_total_min", value: 430 + wobble * 8 - (i === 0 ? 62 : 15) });
    out.push({ date, source: "zepp", metric: "resting_hr_bpm", value: 55 + Math.round(wobble / 2) });
  }
  out.push({ date: TODAY, source: "zepp", metric: "hrv_rmssd_ms", value: 51, appLabel: "Good" });
  return out;
}

export function sampleActivities(): Activity[] {
  return [
    { id: "a1", source: "zepp", date: addDays(TODAY, -6), type: "Run", durationMin: 48, avgHr: 158, zoneMin: [4, 10, 14, 15, 5], rpe: 8, notes: "Run club intervals" },
    { id: "a2", source: "zepp", date: addDays(TODAY, -4), type: "Strength", durationMin: 55, avgHr: 118, notes: "Pull day + sled" },
    { id: "a3", source: "zepp", date: addDays(TODAY, -2), type: "HIIT", durationMin: 40, avgHr: 149, notes: "Hyrox stations" },
    { id: "a4", source: "zepp", date: addDays(TODAY, -1), type: "Walk", durationMin: 35, avgHr: 98 },
  ];
}
