import { NextRequest, NextResponse } from "next/server";
import { isMockN8n, n8nConfigured } from "@/lib/constants";
import { probeDatabase } from "@/lib/db";
import { countInflight } from "@/lib/jobs";
import { ensureN8nWorkflow } from "@/lib/n8n-ensure";
import { ensureSweeper } from "@/lib/sweeper";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    ensureSweeper();
    const database = probeDatabase();
    const heal = request.nextUrl.searchParams.get("heal") === "1";
    const forceSync = request.nextUrl.searchParams.get("syncWorkflow") === "1";
    let n8nEnsure: Awaited<ReturnType<typeof ensureN8nWorkflow>> | null = null;
    if ((heal || forceSync) && !isMockN8n() && n8nConfigured()) {
      n8nEnsure = await ensureN8nWorkflow({ forceSync });
    }
    return NextResponse.json({
      ok: true,
      service: "gtm-demo",
      version: "0.1.0",
      time: new Date().toISOString(),
      database,
      inflight: countInflight(),
      orchestration: {
        mockN8n: isMockN8n(),
        n8nConfigured: n8nConfigured(),
        n8nEnsure,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Database probe failed";
    return NextResponse.json(
      {
        ok: false,
        service: "gtm-demo",
        version: "0.1.0",
        time: new Date().toISOString(),
        error: message,
      },
      { status: 503 },
    );
  }
}
