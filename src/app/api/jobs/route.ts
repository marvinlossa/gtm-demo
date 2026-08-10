import { NextRequest, NextResponse } from "next/server";
import { gateIntake, getClientIp } from "@/lib/auth";
import {
  JOB_ERROR_N8N_TRIGGER,
  MAX_INFLIGHT_JOBS,
  POLL_AFTER_MS,
} from "@/lib/constants";
import { getDb } from "@/lib/db";
import {
  createJob,
  hasCapacity,
  markJobFailed,
  markJobRunning,
} from "@/lib/jobs";
import { scheduleMockCompletion } from "@/lib/mock-complete";
import { buildCallbackUrl, triggerN8nWorkflow } from "@/lib/n8n";
import { getProfile } from "@/lib/profiles";
import { ensureSweeper } from "@/lib/sweeper";
import { parseCompanyInput } from "@/lib/url";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  ensureSweeper();
  const ip = getClientIp(request);
  const body = (await request.json().catch(() => ({}))) as {
    domain?: unknown;
    profileId?: unknown;
    turnstileToken?: unknown;
  };

  const token =
    typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  let company: { domain: string; normalizedUrl: string };
  try {
    company = parseCompanyInput(body.domain);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Enter a valid public domain or URL.",
      },
      { status: 400 },
    );
  }

  const profileId =
    typeof body.profileId === "string" ? body.profileId.trim() : "";
  if (!profileId) {
    return NextResponse.json(
      { error: "Select an ICP profile." },
      { status: 400 },
    );
  }

  const profile = getProfile(getDb(), profileId);
  if (!profile) {
    return NextResponse.json(
      { error: "Unknown profile." },
      { status: 400 },
    );
  }

  const gate = await gateIntake({ ip, turnstileToken: token });
  if (!gate.ok) {
    return NextResponse.json(
      {
        error: gate.error,
        rateLimit: gate.rateLimit
          ? {
              limit: gate.rateLimit.limit,
              remaining: gate.rateLimit.remaining,
              resetAt: new Date(gate.rateLimit.resetAt).toISOString(),
            }
          : undefined,
      },
      { status: gate.status },
    );
  }

  if (!hasCapacity()) {
    return NextResponse.json(
      {
        error: "Server is at capacity. Try again in a few minutes.",
        maxInflight: MAX_INFLIGHT_JOBS,
      },
      { status: 503 },
    );
  }

  const job = createJob({
    domain: company.domain,
    normalizedUrl: company.normalizedUrl,
    profileId: profile.id,
    clientIp: ip,
  });

  const callbackUrl = buildCallbackUrl(job.id);
  const trigger = await triggerN8nWorkflow({
    jobId: job.id,
    domain: company.domain,
    normalizedUrl: company.normalizedUrl,
    profileId: profile.id,
    profile,
    callbackUrl,
  });

  if (!trigger.ok) {
    markJobFailed(job.id, JOB_ERROR_N8N_TRIGGER);
    console.error(
      JSON.stringify({
        event: "n8n_trigger_failed",
        jobId: job.id,
        error: trigger.error,
      }),
    );
    return NextResponse.json(
      {
        error: "Unable to start analysis workflow.",
        code: JOB_ERROR_N8N_TRIGGER,
        jobId: job.id,
        status: "failed",
      },
      { status: 502 },
    );
  }

  markJobRunning(job.id, "research", trigger.executionId);

  console.info(
    JSON.stringify({
      event: "job_started",
      jobId: job.id,
      domain: company.domain,
      profileId: profile.id,
      mock: trigger.mock,
      callbackUrl,
      n8nExecutionId: trigger.executionId ?? null,
    }),
  );

  if (trigger.mock) {
    scheduleMockCompletion(job.id, profile, company.domain);
  }

  return NextResponse.json(
    {
      jobId: job.id,
      status: "running",
      stage: "research",
      pollAfterMs: POLL_AFTER_MS,
      domain: company.domain,
      profileId: profile.id,
      mock: trigger.mock,
    },
    { status: 201 },
  );
}
