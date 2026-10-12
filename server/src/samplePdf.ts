// Renders the proposed PDF layout from sample data, without calling Claude.
//   npm run sample-pdf  ->  out/flow-sample.pdf

import { mkdirSync } from "node:fs";
import { analyze } from "./rules.ts";
import { renderWorkoutPdf } from "./pdf.ts";
import { loadThresholds } from "./service.ts";
import type { WorkoutPlan } from "./coach.ts";
import { TODAY, sampleReadings } from "../test/fixtures/sample.ts";

const report = analyze(TODAY, sampleReadings(), loadThresholds(), { expectedSources: ["ultrahuman", "zepp"] });

const plan: WorkoutPlan = {
  title: "Pull + Skill, capped",
  call: report.call,
  readinessSummary: "HRV 49 red but up from 30 over 7 days. Sleep green on the ring, Zepp reads an hour short. RHR up 4.",
  why: [
    "Effort cap from readiness: HRV still under your 55 line, RHR elevated.",
    "No sled or carries: those are Thursday's Hyrox stations (pattern overlap, not fatigue).",
    "Low-rep skill work keeps the strength stimulus without volume.",
  ],
  blocks: [
    {
      name: "Warm-up", format: "2 rounds",
      exercises: [
        { name: "Scapular pull-ups", sets: "2", reps: "8", load: "BW", rest: "30s", cue: "Shoulders down, no elbow bend" },
        { name: "Skin the cat", sets: "2", reps: "3", load: "BW", rest: "45s", cue: "Slow both ways" },
      ],
    },
    {
      name: "Skill", format: "Straight sets",
      exercises: [
        { name: "Front lever raises (tuck)", sets: "4", reps: "3-5", load: "BW", rest: "2 min", cue: "Hips to bar height, 2s lower" },
        { name: "Wall handstand hold", sets: "3", reps: "30s", load: "BW", rest: "90s", cue: "Ribs in, push tall" },
      ],
    },
    {
      name: "Strength", format: "Straight sets",
      exercises: [
        { name: "Pull-ups", sets: "4", reps: "3-4", load: "BW", rest: "2 min", cue: "Stop 2 reps shy of failure" },
        { name: "Ring rows", sets: "3", reps: "6", load: "Feet elevated", rest: "90s", cue: "Pause at chest" },
      ],
    },
    {
      name: "Conditioning", format: "Zone 2, nasal breathing",
      exercises: [
        { name: "Bike or easy jog", sets: "1", reps: "20 min", load: "Z2 (HR < 145)", rest: "", cue: "Cap it, do not chase pace" },
      ],
    },
    {
      name: "Cool-down", format: "",
      exercises: [
        { name: "Hip flexor + lat stretch", sets: "1", reps: "5 min", load: "", rest: "", cue: "" },
      ],
    },
  ],
  totalMinutes: 60,
  scaleDown: "If warm-up feels heavy, drop the strength block to 3 sets and keep the skill work.",
  tomorrow: "Tue: run club. Treat their workout as the ceiling and scale live.",
};

mkdirSync("out", { recursive: true });
console.log(await renderWorkoutPdf(plan, report, "out/flow-sample.pdf"));
