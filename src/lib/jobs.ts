import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  JOB_ERROR_TIMEOUT,
  JOB_RETENTION_MS,
  JOB_TIMEOUT_MS,
  MAX_INFLIGHT_JOBS,
  SCORING_VERSION,
} from "@/lib/constants";
import { getDb } from "@/lib/db";
import type {
  JobStatus,
  SalesStrategy,
  ScoredResult,
} from "@/lib/types";

export type JobRow = {
  id: string;
  domain: string;
  normalized_url: string;
  profile_id: string;
  status: JobStatus;
  stage: string | null;
  client_ip: string | null;
  n8n_execution_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string;
};

export type JobResultRow = {
  job_id: string;
  scoring_version: string;
  overall_score: number;
  fit_band: string;
  confidence_overall: number;
  unknown_ratio: number;
  attributes_json: string;
  strategy_json: string;
  limitations_json: string;
  meta_json: string | null;
  created_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function addMsIso(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

export function countInflight(db: Database.Database = getDb()) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM jobs WHERE status IN ('pending','running')`,
    )
    .get() as { c: number };
  return row.c;
}

export function hasCapacity(db: Database.Database = getDb()) {
  return countInflight(db) < MAX_INFLIGHT_JOBS;
}

export function createJob(input: {
  domain: string;
  normalizedUrl: string;
  profileId: string;
  clientIp: string;
}): JobRow {
  const db = getDb();
  const id = randomUUID();
  const created = nowIso();
  const expires = addMsIso(JOB_RETENTION_MS);
  db.prepare(
    `INSERT INTO jobs (
      id, domain, normalized_url, profile_id, status, stage,
      client_ip, created_at, updated_at, expires_at
    ) VALUES (
      @id, @domain, @normalized_url, @profile_id, 'pending', NULL,
      @client_ip, @created_at, @updated_at, @expires_at
    )`,
  ).run({
    id,
    domain: input.domain,
    normalized_url: input.normalizedUrl,
    profile_id: input.profileId,
    client_ip: input.clientIp,
    created_at: created,
    updated_at: created,
    expires_at: expires,
  });
  return getJob(id)!;
}

export function getJob(
  id: string,
  db: Database.Database = getDb(),
): JobRow | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
    | JobRow
    | undefined;
  return row ?? null;
}

export function getJobResult(
  jobId: string,
  db: Database.Database = getDb(),
): JobResultRow | null {
  const row = db
    .prepare(`SELECT * FROM job_results WHERE job_id = ?`)
    .get(jobId) as JobResultRow | undefined;
  return row ?? null;
}

export function markJobRunning(
  id: string,
  stage: string = "research",
  executionId?: string,
) {
  const db = getDb();
  db.prepare(
    `UPDATE jobs SET
      status = 'running',
      stage = @stage,
      n8n_execution_id = COALESCE(@executionId, n8n_execution_id),
      updated_at = @updated
     WHERE id = @id AND status = 'pending'`,
  ).run({
    id,
    stage,
    executionId: executionId ?? null,
    updated: nowIso(),
  });
  return getJob(id);
}

export function markJobFailed(
  id: string,
  error: string,
  options?: { onlyIfStatuses?: JobStatus[] },
) {
  const db = getDb();
  const allowed = options?.onlyIfStatuses ?? ["pending", "running"];
  const placeholders = allowed.map(() => "?").join(",");
  db.prepare(
    `UPDATE jobs SET
      status = 'failed',
      error = ?,
      updated_at = ?,
      completed_at = ?
     WHERE id = ? AND status IN (${placeholders})`,
  ).run(error, nowIso(), nowIso(), id, ...allowed);
  return getJob(id);
}

export function updateJobStage(
  id: string,
  stage: string,
  executionId?: string,
) {
  const db = getDb();
  db.prepare(
    `UPDATE jobs SET
      stage = @stage,
      n8n_execution_id = COALESCE(@executionId, n8n_execution_id),
      updated_at = @updated
     WHERE id = @id AND status IN ('pending','running')`,
  ).run({
    id,
    stage,
    executionId: executionId ?? null,
    updated: nowIso(),
  });
  return getJob(id);
}

export function completeJob(input: {
  id: string;
  scored: ScoredResult;
  strategy: SalesStrategy;
  executionId?: string;
  meta?: Record<string, unknown>;
  /** Allow upgrade from failed JOB_TIMEOUT */
  allowTimeoutRecovery?: boolean;
}): { ok: true; job: JobRow } | { ok: false; reason: string } {
  const db = getDb();
  const job = getJob(input.id, db);
  if (!job) return { ok: false, reason: "not_found" };

  if (job.status === "complete") {
    return { ok: true, job };
  }

  if (job.status === "failed") {
    if (
      !(
        input.allowTimeoutRecovery &&
        job.error === JOB_ERROR_TIMEOUT
      )
    ) {
      return { ok: false, reason: "terminal_failed" };
    }
  } else if (job.status !== "pending" && job.status !== "running") {
    return { ok: false, reason: "bad_status" };
  }

  const completedAt = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO job_results (
        job_id, scoring_version, overall_score, fit_band,
        confidence_overall, unknown_ratio, attributes_json,
        strategy_json, limitations_json, meta_json
      ) VALUES (
        @job_id, @scoring_version, @overall_score, @fit_band,
        @confidence_overall, @unknown_ratio, @attributes_json,
        @strategy_json, @limitations_json, @meta_json
      )
      ON CONFLICT(job_id) DO UPDATE SET
        scoring_version = excluded.scoring_version,
        overall_score = excluded.overall_score,
        fit_band = excluded.fit_band,
        confidence_overall = excluded.confidence_overall,
        unknown_ratio = excluded.unknown_ratio,
        attributes_json = excluded.attributes_json,
        strategy_json = excluded.strategy_json,
        limitations_json = excluded.limitations_json,
        meta_json = excluded.meta_json`,
    ).run({
      job_id: input.id,
      scoring_version: input.scored.scoringVersion ?? SCORING_VERSION,
      overall_score: input.scored.overallScore,
      fit_band: input.scored.fitBand,
      confidence_overall: input.scored.confidenceOverall,
      unknown_ratio: input.scored.unknownRatio,
      attributes_json: JSON.stringify(input.scored.attributes),
      strategy_json: JSON.stringify(input.strategy),
      limitations_json: JSON.stringify(input.scored.limitations),
      meta_json: input.meta ? JSON.stringify(input.meta) : null,
    });

    db.prepare(
      `UPDATE jobs SET
        status = 'complete',
        stage = 'done',
        error = NULL,
        n8n_execution_id = COALESCE(@executionId, n8n_execution_id),
        updated_at = @updated,
        completed_at = @completed
       WHERE id = @id`,
    ).run({
      id: input.id,
      executionId: input.executionId ?? null,
      updated: completedAt,
      completed: completedAt,
    });
  });

  tx();
  return { ok: true, job: getJob(input.id)! };
}

/** Parse SQLite datetime as UTC ms (handles ISO and SQLite datetime('now')). */
export function jobCreatedAtMs(createdAt: string) {
  const asIso = createdAt.includes("T")
    ? createdAt
    : createdAt.replace(" ", "T") + "Z";
  const ms = Date.parse(asIso);
  return Number.isFinite(ms) ? ms : Date.parse(createdAt);
}

export function expireIfNeeded(jobId: string): JobRow | null {
  const job = getJob(jobId);
  if (!job) return null;
  if (job.status !== "pending" && job.status !== "running") return job;
  const age = Date.now() - jobCreatedAtMs(job.created_at);
  if (age > JOB_TIMEOUT_MS) {
    markJobFailed(jobId, JOB_ERROR_TIMEOUT);
    return getJob(jobId);
  }
  return job;
}

export function sweepTimedOutJobs() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, created_at FROM jobs WHERE status IN ('pending','running')`,
    )
    .all() as Array<{ id: string; created_at: string }>;
  let n = 0;
  for (const row of rows) {
    if (Date.now() - jobCreatedAtMs(row.created_at) > JOB_TIMEOUT_MS) {
      markJobFailed(row.id, JOB_ERROR_TIMEOUT);
      n += 1;
    }
  }
  return n;
}

export function sweepExpiredJobs() {
  const db = getDb();
  const now = nowIso();
  const result = db
    .prepare(`DELETE FROM jobs WHERE expires_at < ?`)
    .run(now);
  return result.changes;
}

export function toPublicJob(job: JobRow, result?: JobResultRow | null) {
  const base = {
    id: job.id,
    domain: job.domain,
    normalizedUrl: job.normalized_url,
    profileId: job.profile_id,
    status: job.status,
    stage: job.stage,
    error: job.error,
    n8nExecutionId: job.n8n_execution_id,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
    expiresAt: job.expires_at,
  };

  if (!result || job.status !== "complete") {
    return { ...base, result: null };
  }

  return {
    ...base,
    result: {
      scoringVersion: result.scoring_version,
      overallScore: result.overall_score,
      fitBand: result.fit_band,
      confidenceOverall: result.confidence_overall,
      unknownRatio: result.unknown_ratio,
      attributes: JSON.parse(result.attributes_json) as unknown,
      strategy: JSON.parse(result.strategy_json) as unknown,
      limitations: JSON.parse(result.limitations_json) as unknown,
      meta: result.meta_json ? (JSON.parse(result.meta_json) as unknown) : null,
    },
  };
}
