import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedProfiles } from "@/lib/profiles";

export const runtimeHint = "nodejs" as const;

let dbSingleton: Database.Database | null = null;
let profilesSeeded = false;

/** Resolve SQLite path: Railway volume, local .data, or :memory: for tests. */
export function resolveDatabasePath() {
  const fromEnv =
    process.env.SQLITE_PATH?.trim() || process.env.DATABASE_PATH?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), ".data", "gtm-demo.sqlite");
}

function ensureParentDir(filePath: string) {
  if (filePath === ":memory:") return;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function markMigration(db: Database.Database, id: string) {
  const applied = db
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .get(id);
  if (!applied) {
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(id);
  }
}

function applyBaseSchema(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      version INTEGER NOT NULL,
      attributes_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      status TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed')),
      stage TEXT,
      client_ip TEXT,
      n8n_execution_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_client_ip_created ON jobs(client_ip, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expires_at);

    CREATE TABLE IF NOT EXISTS job_results (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      scoring_version TEXT NOT NULL,
      overall_score INTEGER NOT NULL,
      fit_band TEXT NOT NULL,
      confidence_overall REAL NOT NULL,
      unknown_ratio REAL NOT NULL,
      attributes_json TEXT NOT NULL,
      strategy_json TEXT NOT NULL,
      limitations_json TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // WAL is preferred on disk; :memory: may ignore/fallback.
  try {
    db.pragma("journal_mode = WAL");
  } catch {
    /* ignore */
  }

  markMigration(db, "001_base");
  markMigration(db, "002_profiles_jobs");
}

function seedIfNeeded(db: Database.Database) {
  if (profilesSeeded) return;
  // Skip disk seed when running pure unit tests that only need rate_limits,
  // unless profiles dir exists (normal app + profile tests).
  const dir = path.join(process.cwd(), "data", "profiles");
  if (!fs.existsSync(dir)) {
    profilesSeeded = true;
    return;
  }
  try {
    seedProfiles(db);
    profilesSeeded = true;
  } catch (error) {
    // Surface on first profiles API call / health rather than crash boot in odd paths.
    console.error("[gtm-demo] profile seed failed:", error);
    throw error;
  }
}

function openDatabase(filePath: string, readonly = false) {
  ensureParentDir(filePath);
  const db = new Database(filePath, {
    readonly,
    fileMustExist: false,
  });
  if (!readonly) {
    db.pragma("foreign_keys = ON");
    applyBaseSchema(db);
    seedIfNeeded(db);
  }
  return db;
}

/**
 * Process-wide SQLite singleton. Node runtime only (not Edge).
 * Single Railway replica assumed for MVP.
 */
export function getDb() {
  if (dbSingleton) return dbSingleton;
  dbSingleton = openDatabase(resolveDatabasePath());
  return dbSingleton;
}

/** Close and reopen at an explicit path (tests). */
export function resetDb(filePath = ":memory:") {
  closeDb();
  profilesSeeded = false;
  dbSingleton = openDatabase(filePath);
  return dbSingleton;
}

/** Close singleton (tests / shutdown). */
export function closeDb() {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  profilesSeeded = false;
}

/** Health probe: open DB, ensure profiles seeded, run trivial query. */
export function probeDatabase() {
  const filePath = resolveDatabasePath();
  const db = getDb();
  const row = db.prepare("SELECT 1 AS ok").get() as { ok: number };
  const profileCount = (
    db.prepare("SELECT COUNT(*) AS c FROM profiles").get() as { c: number }
  ).c;
  return {
    ok: row.ok === 1,
    path: filePath,
    driver: "better-sqlite3" as const,
    profileCount,
  };
}
