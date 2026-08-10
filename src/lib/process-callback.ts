import {
  JOB_ERROR_CALLBACK_VALIDATION,
  JOB_ERROR_TIMEOUT,
} from "@/lib/constants";
import {
  completeJob,
  getJob,
  markJobFailed,
  updateJobStage,
  type JobRow,
} from "@/lib/jobs";
import { getProfile } from "@/lib/profiles";
import { getDb } from "@/lib/db";
import { scoreFindings } from "@/lib/scoring";
import type { SalesStrategy } from "@/lib/types";
import { parseCallbackBody, type CallbackBody } from "@/lib/validate";

export type ProcessCallbackResult =
  | { ok: true; job: JobRow; recovered?: boolean; noop?: boolean }
  | { ok: false; status: number; error: string };

export function processCallback(
  jobId: string,
  rawBody: unknown,
): ProcessCallbackResult {
  const job = getJob(jobId);
  if (!job) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const parsed = parseCallbackBody(rawBody);
  if (!parsed.ok) {
    if (job.status === "pending" || job.status === "running") {
      markJobFailed(jobId, JOB_ERROR_CALLBACK_VALIDATION);
    }
    return {
      ok: false,
      status: 400,
      error: `CALLBACK_VALIDATION: ${parsed.error}`,
    };
  }

  const body = parsed.data;
  return applyCallback(job, body);
}

function applyCallback(job: JobRow, body: CallbackBody): ProcessCallbackResult {
  if (body.status === "running") {
    if (job.status === "complete" || job.status === "failed") {
      return { ok: true, job, noop: true };
    }
    const updated = updateJobStage(
      job.id,
      body.stage,
      body.executionId,
    );
    console.info(
      JSON.stringify({
        event: "job_stage",
        jobId: job.id,
        domain: job.domain,
        stage: body.stage,
        n8nExecutionId: body.executionId ?? null,
      }),
    );
    return { ok: true, job: updated ?? job };
  }

  if (body.status === "failed") {
    if (job.status === "complete") {
      return { ok: true, job, noop: true };
    }
    if (job.status === "failed") {
      return { ok: true, job, noop: true };
    }
    const updated = markJobFailed(job.id, body.error);
    if (body.executionId) {
      getDb()
        .prepare(
          `UPDATE jobs SET n8n_execution_id = COALESCE(?, n8n_execution_id), updated_at = ? WHERE id = ?`,
        )
        .run(body.executionId, new Date().toISOString(), job.id);
    }
    console.info(
      JSON.stringify({
        event: "job_failed_callback",
        jobId: job.id,
        n8nExecutionId: body.executionId ?? null,
        error: body.error,
      }),
    );
    return { ok: true, job: getJob(job.id) ?? updated! };
  }

  // complete
  if (job.status === "complete") {
    return { ok: true, job, noop: true };
  }

  if (job.status === "failed" && job.error !== JOB_ERROR_TIMEOUT) {
    console.info(
      JSON.stringify({
        event: "late_callback_ignored",
        jobId: job.id,
        error: job.error,
      }),
    );
    return { ok: true, job, noop: true };
  }

  const profile = getProfile(getDb(), job.profile_id);
  if (!profile) {
    markJobFailed(job.id, "PROFILE_MISSING");
    return { ok: false, status: 500, error: "Profile missing for job." };
  }

  const scored = scoreFindings(profile, body.findings);
  const strategy = body.strategy as SalesStrategy;
  const recovered = job.status === "failed" && job.error === JOB_ERROR_TIMEOUT;

  const result = completeJob({
    id: job.id,
    scored,
    strategy,
    executionId: body.executionId,
    meta: body.meta as Record<string, unknown> | undefined,
    allowTimeoutRecovery: recovered,
  });

  if (!result.ok) {
    return { ok: false, status: 409, error: result.reason };
  }

  const durationMs = Date.now() - Date.parse(job.created_at.includes("T")
    ? job.created_at
    : job.created_at.replace(" ", "T") + "Z");
  console.info(
    JSON.stringify({
      event: recovered ? "late_callback_recovered" : "job_complete",
      jobId: job.id,
      domain: job.domain,
      n8nExecutionId: body.executionId ?? null,
      overallScore: scored.overallScore,
      fitBand: scored.fitBand,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      meta: body.meta ?? null,
    }),
  );

  return { ok: true, job: result.job, recovered };
}
