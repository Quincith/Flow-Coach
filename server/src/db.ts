import { DatabaseSync } from "node:sqlite";
import type { Activity, Metric, Reading, Source } from "./types.ts";

export type DB = DatabaseSync;

export function openDb(path = process.env.FLOW_DB ?? "flow-coach.db"): DB {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS readings (
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      app_label TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (date, source, metric)
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      duration_min REAL NOT NULL,
      avg_hr REAL,
      max_hr REAL,
      zone_min TEXT,
      training_load REAL,
      rpe REAL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      source TEXT PRIMARY KEY,
      last_success TEXT,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plans (
      date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      approved_at TEXT
    );
  `);
  return db;
}

export function upsertReadings(db: DB, readings: Reading[]): number {
  const stmt = db.prepare(`
    INSERT INTO readings (date, source, metric, value, app_label)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (date, source, metric)
    DO UPDATE SET value = excluded.value, app_label = excluded.app_label, updated_at = datetime('now')
  `);
  let n = 0;
  for (const r of readings) {
    if (!Number.isFinite(r.value)) continue;
    stmt.run(r.date, r.source, r.metric, r.value, r.appLabel ?? null);
    n++;
  }
  return n;
}

export function upsertActivities(db: DB, activities: Activity[]): number {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO activities
      (id, source, date, type, duration_min, avg_hr, max_hr, zone_min, training_load, rpe, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of activities) {
    stmt.run(
      a.id, a.source, a.date, a.type, a.durationMin, a.avgHr ?? null, a.maxHr ?? null,
      a.zoneMin ? JSON.stringify(a.zoneMin) : null, a.trainingLoad ?? null, a.rpe ?? null, a.notes ?? null,
    );
  }
  return activities.length;
}

/** All readings in [from, to], inclusive. */
export function readingsBetween(db: DB, from: string, to: string): Reading[] {
  const rows = db
    .prepare(`SELECT date, source, metric, value, app_label FROM readings WHERE date BETWEEN ? AND ? ORDER BY date`)
    .all(from, to) as { date: string; source: Source; metric: Metric; value: number; app_label: string | null }[];
  return rows.map((r) => ({
    date: r.date, source: r.source, metric: r.metric, value: r.value,
    ...(r.app_label ? { appLabel: r.app_label } : {}),
  }));
}

export function activitiesBetween(db: DB, from: string, to: string): Activity[] {
  const rows = db
    .prepare(`SELECT * FROM activities WHERE date BETWEEN ? AND ? ORDER BY date`)
    .all(from, to) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    source: r.source as Source,
    date: r.date as string,
    type: r.type as string,
    durationMin: r.duration_min as number,
    avgHr: (r.avg_hr as number | null) ?? undefined,
    maxHr: (r.max_hr as number | null) ?? undefined,
    zoneMin: r.zone_min ? (JSON.parse(r.zone_min as string) as number[]) : undefined,
    trainingLoad: (r.training_load as number | null) ?? undefined,
    rpe: (r.rpe as number | null) ?? undefined,
    notes: (r.notes as string | null) ?? undefined,
  }));
}

export function recordSync(db: DB, source: Source, error?: string): void {
  db.prepare(`
    INSERT INTO sync_state (source, last_success, last_error) VALUES (?, ?, ?)
    ON CONFLICT (source) DO UPDATE SET
      last_success = COALESCE(excluded.last_success, sync_state.last_success),
      last_error = excluded.last_error
  `).run(source, error ? null : new Date().toISOString(), error ?? null);
}
