import { spawn } from "node:child_process";
import path from "node:path";
import { JOB_TIMEOUT_MS } from "@/lib/constants";
import { getJob } from "@/lib/jobs";
import { processCallback } from "@/lib/process-callback";
import type { Profile } from "@/lib/types";

export type AnalysisStart = {
  jobId: string;
  domain: string;
  normalizedUrl: string;
  profile: Profile;
  executionId: string;
};

function pythonBin() {
  if (process.env.PYTHON_BIN?.trim()) return process.env.PYTHON_BIN.trim();
  return process.platform === "win32" ? "python" : "python3";
}

/**
 * Run gtm-fit-analysis in a child process. Stage lines call the same
 * callback handler the UI already polls. The process is killed at the job limit.
 */
export function startAnalysis(input: AnalysisStart): Promise<void> {
  const script = path.join(process.cwd(), "python", "gtm_fit_analysis.py");
  const child = spawn(pythonBin(), [script], {
    stdio: ["pipe", "pipe", "ignore"],
    env: process.env,
  });
  let settled = false;
  let buffer = "";

  return new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill();
    finish({
      status: "failed",
      executionId: input.executionId,
      error: "JOB_TIMEOUT",
    });
  }, JOB_TIMEOUT_MS);
  timer.unref?.();

  function finish(body: Record<string, unknown>) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      const result = processCallback(input.jobId, body);
      if (!result.ok) {
        console.error(
          JSON.stringify({
            event: "analysis_callback_rejected",
            jobId: input.jobId,
            error: result.error,
          }),
        );
      }
    } finally {
      resolve();
    }
  }

  function onLine(line: string) {
    let event: { type?: string; body?: Record<string, unknown> };
    try {
      event = JSON.parse(line) as { type?: string; body?: Record<string, unknown> };
    } catch {
      return;
    }
    if (event.type !== "callback" || !event.body) return;
    const status = event.body.status;
    if (status === "complete" || status === "failed") {
      finish(event.body);
      return;
    }
    processCallback(input.jobId, event.body);
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
      newline = buffer.indexOf("\n");
    }
  });

  child.on("error", (error) => {
    console.error(
      JSON.stringify({
        event: "analysis_spawn_error",
        jobId: input.jobId,
        error: error.message,
      }),
    );
    finish({
      status: "failed",
      executionId: input.executionId,
      error: "ANALYSIS_START_FAILED",
    });
  });

  child.on("close", () => {
    if (buffer.trim()) onLine(buffer.trim());
    if (settled) return;
    const job = getJob(input.jobId);
    if (job && (job.status === "pending" || job.status === "running")) {
      finish({
        status: "failed",
        executionId: input.executionId,
        error: "ANALYSIS_INCOMPLETE",
      });
      return;
    }
    settled = true;
    clearTimeout(timer);
    resolve();
  });

  const payload = {
    jobId: input.jobId,
    domain: input.domain,
    normalizedUrl: input.normalizedUrl,
    profileId: input.profile.id,
    callbackUrl: `internal://jobs/${input.jobId}`,
    executionId: input.executionId,
    attributes: input.profile.attributes.map((attribute) => ({
      id: attribute.id,
      label: attribute.label,
      weight: attribute.weight,
      researchPrompt: attribute.researchPrompt.replaceAll(
        "{domain}",
        input.domain,
      ),
      positiveSignals: attribute.positiveSignals,
      negativeSignals: attribute.negativeSignals,
    })),
  };
  child.stdin.write(JSON.stringify(payload));
  child.stdin.end();
  });
}
