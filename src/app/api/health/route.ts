import { NextResponse } from "next/server";
import { isMockN8n, n8nConfigured } from "@/lib/constants";
import { probeDatabase } from "@/lib/db";
import { countInflight } from "@/lib/jobs";
import { ensureSweeper } from "@/lib/sweeper";

export const runtime = "nodejs";

export async function GET() {
  try {
    ensureSweeper();
    const database = probeDatabase();
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
