// CLI for a scheduler (cron, GitHub Actions, Render cron): sync sources and run the morning check-in.
//   npm run morning                      sync + check-in for today
//   npm run morning -- --report-only     sync + print the computed report, no Claude call
//   npm run morning -- --dump-ultrahuman print the raw Ultrahuman response (to verify parsing)

import { openDb } from "./db.ts";
import { renderReport } from "./coach.ts";
import { buildReport, morningCheckIn, syncAll } from "./service.ts";
import { fetchUltrahuman } from "./sources/ultrahuman.ts";

const tz = process.env.FLOW_TZ ?? "America/New_York";
const date = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
  ?? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

if (process.argv.includes("--dump-ultrahuman")) {
  const { raw } = await fetchUltrahuman(date, process.env.ULTRAHUMAN_TOKEN!, process.env.ULTRAHUMAN_EMAIL);
  console.log(JSON.stringify(raw, null, 2));
  process.exit(0);
}

const db = openDb();
for (const line of await syncAll(db, date)) console.log(line);
if (process.argv.includes("--report-only")) {
  console.log(renderReport(buildReport(db, date)));
} else {
  const { message } = await morningCheckIn(db, date);
  console.log(message);
}
