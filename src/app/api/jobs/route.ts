import { after, NextRequest, NextResponse } from "next/server";
import { gateIntake, getClientIp } from "@/lib/auth";
import {
  isMockN8n,
  MAX_INFLIGHT_JOBS,
  POLL_AFTER_MS,
} from "@/lib/constants";
import { getDb, withDb } from "@/lib/db";
import { createJob, hasCapacity, markJobRunning } from "@/lib/jobs";
import { scheduleMockCompletion } from "@/lib/mock-complete";
import { getProfile } from "@/lib/profiles";
import { startAnalysis } from "@/lib/run-analysis";
import { runSweepOnce } from "@/lib/sweeper";
import { parseCompanyInput } from "@/lib/url";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

  const started = withDb(() => {
    runSweepOnce();
    const profile = getProfile(getDb(), profileId);
    if (!profile) return { error: "unknown" as const };
    if (!hasCapacity()) return { error: "capacity" as const };
    const job = createJob({
      domain: company.domain,
      normalizedUrl: company.normalizedUrl,
      profileId: profile.id,
      clientIp: ip,
    });
    const mock = isMockN8n();
    const executionId = mock
      ? `mock-${job.id.slice(0, 8)}`
      : `py-${job.id.slice(0, 8)}`;
    markJobRunning(job.id, "research", executionId);
    return { error: null, job, profile, mock, executionId };
  });

  if (started.error === "unknown") {
    return NextResponse.json({ error: "Unknown profile." }, { status: 400 });
  }
  if (started.error === "capacity") {
    return NextResponse.json(
      {
        error: "Server is at capacity. Try again in a few minutes.",
        maxInflight: MAX_INFLIGHT_JOBS,
      },
      { status: 503 },
    );
  }

  const { job, profile, mock, executionId } = started;

  console.info(
    JSON.stringify({
      event: "job_started",
      jobId: job.id,
      domain: company.domain,
      profileId: profile.id,
      mock,
      n8nExecutionId: executionId,
    }),
  );

  if (mock) {
    scheduleMockCompletion(job.id, profile, company.domain);
  } else {
    after(async () => {
      try {
        await startAnalysis({
          jobId: job.id,
          domain: company.domain,
          normalizedUrl: company.normalizedUrl,
          profile,
          executionId,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "analysis_spawn_error",
            jobId: job.id,
            error: error instanceof Error ? error.message : "start failed",
          }),
        );
      }
    });
  }

  return NextResponse.json(
    {
      jobId: job.id,
      status: "running",
      stage: "research",
      pollAfterMs: POLL_AFTER_MS,
      domain: company.domain,
      profileId: profile.id,
      mock,
    },
    { status: 201 },
  );
}
