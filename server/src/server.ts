// Minimal HTTP API for the iPhone app. Every request needs `Authorization: Bearer $FLOW_API_TOKEN`.
//
//   POST /health      Apple Health / Health Connect day aggregates from the phone
//   POST /sync        pull cloud sources (Ultrahuman, intervals.icu) now
//   GET  /today       computed readiness report
//   POST /checkin     morning read + proposed workout (runs the coach)
//   POST /chat        { text } reply to the coach; "yes" / "lock it in" renders the PDF
//   GET  /messages    today's conversation (the scheduled morning read lands here)
//   GET  /pdf/:date   the approved workout PDF (also accepts ?token=)
//
// FLOW_CHECKIN_TIME (HH:MM, athlete's timezone, default 06:30) runs sync + the morning read daily.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { openDb, upsertReadings } from "./db.ts";
import { parseHealthPayload, type HealthPayload } from "./sources/healthkit.ts";
import { buildReport, handleMessage, history, morningCheckIn, syncAll } from "./service.ts";

const db = openDb();
const TOKEN = process.env.FLOW_API_TOKEN;
const OUT = process.env.FLOW_OUT_DIR ?? "out";
if (!TOKEN) throw new Error("Set FLOW_API_TOKEN");

/** Local calendar date for the athlete, not UTC, so a 6am check-in lands on the right day. */
export const localDate = (tz = process.env.FLOW_TZ ?? "America/New_York") =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === "/healthz") return json(res, 200, { ok: true });
    // PDFs open in the phone's browser, which can't send headers, so they also accept ?token=.
    const authed = req.headers.authorization === `Bearer ${TOKEN}`
      || (url.pathname.startsWith("/pdf/") && url.searchParams.get("token") === TOKEN);
    if (!authed) return json(res, 401, { error: "unauthorized" });
    const date = url.searchParams.get("date") ?? localDate();

    if (req.method === "POST" && url.pathname === "/health") {
      const n = upsertReadings(db, parseHealthPayload(await body<HealthPayload>(req)));
      return json(res, 200, { stored: n });
    }
    if (req.method === "POST" && url.pathname === "/sync") return json(res, 200, { log: await syncAll(db, date) });
    if (req.method === "GET" && url.pathname === "/today") return json(res, 200, buildReport(db, date));
    if (req.method === "POST" && url.pathname === "/checkin") {
      await syncAll(db, date);
      return json(res, 200, await morningCheckIn(db, date));
    }
    if (req.method === "GET" && url.pathname === "/messages") return json(res, 200, { date, messages: history(db, date) });
    if (req.method === "POST" && url.pathname === "/chat") {
      const { text } = await body<{ text: string }>(req);
      const out = await handleMessage(db, date, text, OUT);
      return json(res, 200, { message: out.message, pdf: out.pdfPath ? `/pdf/${date}` : undefined });
    }
    const pdf = url.pathname.match(/^\/pdf\/(\d{4}-\d{2}-\d{2})$/);
    if (req.method === "GET" && pdf) {
      const path = `${OUT}/flow-${pdf[1]}.pdf`;
      if (!existsSync(path)) return json(res, 404, { error: "no approved plan for that date" });
      res.writeHead(200, { "content-type": "application/pdf" });
      return void createReadStream(path).pipe(res);
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e) });
  }
});

/** Minute-resolution daily scheduler; good enough for one athlete and avoids a separate cron service. */
const CHECKIN = process.env.FLOW_CHECKIN_TIME ?? "06:30";
let lastRun = "";
setInterval(async () => {
  const tz = process.env.FLOW_TZ ?? "America/New_York";
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const today = localDate();
  if (hm < CHECKIN || lastRun === today) return;
  lastRun = today;
  try {
    await syncAll(db, today);
    await morningCheckIn(db, today);
    console.log(`morning check-in done for ${today}`);
  } catch (e) {
    console.error("morning check-in failed", e);
  }
}, 60_000);

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`Flow Coach API on :${port}`));
