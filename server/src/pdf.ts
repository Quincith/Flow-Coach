// One-page workout sheet. Layout (proposed "locked format", v1):
//  1. Header: title, date, call badge
//  2. Readiness strip: each metric with value and his-table band color
//  3. Why today: 2-3 bullets
//  4. Session blocks: table of exercise / sets / reps / load / rest / cue
//  5. Footer: scale-down rule and tomorrow preview

import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { formatValue } from "./rules.ts";
import type { WorkoutPlan } from "./coach.ts";
import type { Band, ReadinessReport } from "./types.ts";

const INK = "#111827";
const MUTED = "#6B7280";
const RULE = "#E5E7EB";
const BAND: Record<Band, string> = { green: "#15803D", yellow: "#B45309", red: "#B91C1C" };
const CALL: Record<WorkoutPlan["call"], { label: string; color: string }> = {
  go: { label: "GO", color: BAND.green },
  moderate: { label: "MODERATE", color: BAND.yellow },
  cap: { label: "CAPPED", color: BAND.red },
};

export function renderWorkoutPdf(plan: WorkoutPlan, report: ReadinessReport, outPath: string): Promise<string> {
  const doc = new PDFDocument({ size: "LETTER", margin: 40 });
  const done = new Promise<string>((resolve, reject) => {
    const stream = createWriteStream(outPath);
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
    doc.pipe(stream);
  });
  const left = 40;
  const width = doc.page.width - 80;

  // 1. Header
  const day = new Date(`${report.date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: "UTC",
  });
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`FLOW COACH  ·  ${day.toUpperCase()}`, left, 40);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(plan.title, left, 54, { width: width - 110 });
  const badge = CALL[plan.call];
  doc.roundedRect(left + width - 100, 54, 100, 24, 4).fill(badge.color);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(11).text(badge.label, left + width - 100, 61, { width: 100, align: "center" });
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`${plan.totalMinutes} min`, left + width - 100, 82, { width: 100, align: "center" });

  // 2. Readiness strip
  let y = Math.max(doc.y, 96) + 8;
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor(RULE).stroke();
  y += 8;
  const shown = report.verdicts.filter((v) => v.value !== null).slice(0, 6);
  const cell = width / Math.max(shown.length, 1);
  shown.forEach((v, i) => {
    const x = left + i * cell;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(v.label.toUpperCase(), x, y, { width: cell - 6 });
    doc.fillColor(v.band ? BAND[v.band] : INK).font("Helvetica-Bold").fontSize(13)
      .text(formatValue(v.metric, v.value!), x, y + 11, { width: cell - 6 });
    const arrow = v.trend === "rising" ? "up" : v.trend === "falling" ? "down" : v.trend === "flat" ? "flat" : "";
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`${v.band ?? ""}${arrow ? ` · ${arrow}` : ""}`, x, y + 28, { width: cell - 6 });
  });
  y += 44;
  doc.fillColor(INK).font("Helvetica").fontSize(9).text(plan.readinessSummary, left, y, { width });
  for (const f of report.flags) doc.fillColor(BAND.yellow).fontSize(8.5).text(`! ${f}`, { width });
  y = doc.y + 8;
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor(RULE).stroke();

  // 3. Why today
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("WHY TODAY", left, y + 8);
  doc.font("Helvetica").fontSize(9.5);
  for (const w of plan.why) doc.text(`•  ${w}`, left, doc.y + 2, { width });

  // 4. Blocks
  const cols = [
    { key: "name", label: "EXERCISE", w: 0.3 },
    { key: "sets", label: "SETS", w: 0.07 },
    { key: "reps", label: "REPS", w: 0.12 },
    { key: "load", label: "LOAD", w: 0.11 },
    { key: "rest", label: "REST", w: 0.09 },
    { key: "cue", label: "CUE", w: 0.31 },
  ] as const;
  for (const block of plan.blocks) {
    doc.moveDown(0.8);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11)
      .text(block.name.toUpperCase(), left, doc.y, { continued: !!block.format });
    if (block.format) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`   ${block.format}`);
    let rowY = doc.y + 4;
    let x = left;
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
    for (const c of cols) { doc.text(c.label, x, rowY, { width: width * c.w - 4 }); x += width * c.w; }
    rowY += 11;
    for (const ex of block.exercises) {
      x = left;
      let rowH = 0;
      doc.fillColor(INK).fontSize(9);
      for (const c of cols) {
        const text = ex[c.key] || "";
        doc.font(c.key === "name" ? "Helvetica-Bold" : "Helvetica").fillColor(c.key === "cue" ? MUTED : INK);
        const h = doc.heightOfString(text, { width: width * c.w - 4 });
        doc.text(text, x, rowY, { width: width * c.w - 4 });
        rowH = Math.max(rowH, h);
        x += width * c.w;
      }
      rowY += rowH + 4;
      doc.moveTo(left, rowY - 2).lineTo(left + width, rowY - 2).strokeColor(RULE).lineWidth(0.5).stroke();
    }
    doc.y = rowY;
  }

  // 5. Footer
  doc.moveDown(1);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text("SCALE DOWN IF NEEDED  ", left, doc.y, { continued: true })
    .font("Helvetica").fillColor(INK).text(plan.scaleDown, { width });
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").text("TOMORROW  ", { continued: true }).font("Helvetica").fillColor(MUTED).text(plan.tomorrow, { width });

  doc.end();
  return done;
}
