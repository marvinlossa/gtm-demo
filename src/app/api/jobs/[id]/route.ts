import { NextRequest, NextResponse } from "next/server";
import { checkPollRateLimit, getClientIp } from "@/lib/auth";
import { expireIfNeeded, getJobResult, toPublicJob } from "@/lib/jobs";
import { ensureSweeper } from "@/lib/sweeper";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  ensureSweeper();
  const { id } = await context.params;
  if (!id || id.length < 8) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const ip = getClientIp(request);
  const pollLimit = checkPollRateLimit(ip);
  if (!pollLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many poll requests. Slow down.",
        rateLimit: {
          limit: pollLimit.limit,
          remaining: 0,
          resetAt: new Date(pollLimit.resetAt).toISOString(),
        },
      },
      { status: 429 },
    );
  }

  const job = expireIfNeeded(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  // Hide expired jobs
  if (Date.parse(job.expires_at) < Date.now()) {
    return NextResponse.json({ error: "Job expired." }, { status: 410 });
  }

  const result = job.status === "complete" ? getJobResult(job.id) : null;
  return NextResponse.json(toPublicJob(job, result));
}
