import { NextRequest, NextResponse } from "next/server";
import { verifyCallbackSecret } from "@/lib/callback-auth";
import { processCallback } from "@/lib/process-callback";
import { ensureSweeper } from "@/lib/sweeper";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  ensureSweeper();
  const { id } = await context.params;

  if (!verifyCallbackSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body == null) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = processCallback(id, body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    jobId: result.job.id,
    status: result.job.status,
    recovered: result.recovered ?? false,
    noop: result.noop ?? false,
  });
}
