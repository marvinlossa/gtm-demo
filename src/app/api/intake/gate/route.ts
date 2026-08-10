import { NextRequest, NextResponse } from "next/server";
import { gateIntake, getClientIp } from "@/lib/auth";
import { parseCompanyInput } from "@/lib/url";

export const runtime = "nodejs";

/**
 * Demo protection gate (content-review shape):
 * allowlisted IP → skip Turnstile + daily limit;
 * else Turnstile then SQLite-backed daily limit.
 * Also validates domain/URL when provided.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const body = (await request.json().catch(() => ({}))) as {
    turnstileToken?: unknown;
    domain?: unknown;
  };

  if (body.domain !== undefined && body.domain !== null && body.domain !== "") {
    try {
      parseCompanyInput(body.domain);
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
  }

  const token =
    typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  const result = await gateIntake({ ip, turnstileToken: token });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        rateLimit: result.rateLimit
          ? {
              limit: result.rateLimit.limit,
              remaining: result.rateLimit.remaining,
              resetAt: new Date(result.rateLimit.resetAt).toISOString(),
            }
          : undefined,
      },
      { status: result.status },
    );
  }

  let company: { domain: string; normalizedUrl: string } | null = null;
  if (body.domain) {
    try {
      company = parseCompanyInput(body.domain);
    } catch {
      company = null;
    }
  }

  return NextResponse.json({
    ok: true,
    admin: result.admin,
    limit: result.rateLimit?.limit ?? null,
    remaining: result.rateLimit?.remaining ?? null,
    resetAt: result.rateLimit
      ? new Date(result.rateLimit.resetAt).toISOString()
      : null,
    company,
  });
}
