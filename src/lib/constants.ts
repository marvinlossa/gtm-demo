export const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS) || 240_000;
export const JOB_RETENTION_MS =
  Number(process.env.JOB_RETENTION_MS) || 48 * 60 * 60 * 1000;
export const MAX_INFLIGHT_JOBS = Number(process.env.MAX_INFLIGHT_JOBS) || 3;
export const N8N_TRIGGER_TIMEOUT_MS =
  Number(process.env.N8N_TRIGGER_TIMEOUT_MS) || 10_000;
export const POLL_AFTER_MS = 2_000;
export const JOB_ERROR_TIMEOUT = "JOB_TIMEOUT";
export const JOB_ERROR_N8N_TRIGGER = "N8N_TRIGGER_FAILED";
export const JOB_ERROR_CALLBACK_VALIDATION = "CALLBACK_VALIDATION";
export const SCORING_VERSION = "scoring.v1";

export function isMockN8n() {
  const v = (process.env.MOCK_N8N ?? "1").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** True when live n8n is configured (for health/debug). */
export function n8nConfigured() {
  return Boolean(
    process.env.N8N_WEBHOOK_URL?.trim() &&
      process.env.GTM_WEBHOOK_SECRET?.trim(),
  );
}
