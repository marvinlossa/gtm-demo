import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ORIGINS = new Set([
  "https://marvinlossa.com",
  "https://www.marvinlossa.com",
]);

/**
 * Wake probe for the portfolio interstitial.
 * No external calls, no database, no timers.
 */
export function GET(request: NextRequest) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}
