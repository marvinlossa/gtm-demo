-- Canonical schema (applied by src/lib/db.ts on open).
PRAGMA journal_mode = WAL;
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
