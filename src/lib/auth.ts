import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 2;
const DEFAULT_GET_LIMIT_PER_MIN = 60;

type TurnstileResponse = { success: boolean; "error-codes"?: string[] };

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export function getClientIp(request: NextRequest) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function parseAllowlist() {
  return (process.env.ADMIN_IP_ALLOWLIST ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

export function isAllowlisted(ip: string) {
  return parseAllowlist().includes(ip);
}

function getDailyLimit() {
  const parsed = Number(process.env.INTAKE_DAILY_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

function getPollLimitPerMinute() {
  const parsed = Number(process.env.GET_POLL_LIMIT_PER_MIN);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_GET_LIMIT_PER_MIN;
}

/**
 * Durable per-key rate limit stored in SQLite (survives process restarts on volume).
 * Window length is controlled by the caller via windowMs on first create.
 */
export function checkKeyedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const db = getDb();
  const now = Date.now();

  db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(now);

  const existing = db
    .prepare("SELECT key, count, reset_at FROM rate_limits WHERE key = ?")
    .get(key) as { key: string; count: number; reset_at: number } | undefined;

  if (!existing || existing.reset_at <= now) {
    const resetAt = now + windowMs;
    db.prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
    ).run(key, resetAt);
    return { allowed: true, limit, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: existing.reset_at,
    };
  }

  const nextCount = existing.count + 1;
  db.prepare("UPDATE rate_limits SET count = ? WHERE key = ?").run(
    nextCount,
    key,
  );
  return {
    allowed: true,
    limit,
    remaining: limit - nextCount,
    resetAt: existing.reset_at,
  };
}

/** Intake daily limit per client IP (default 2). */
export function checkRateLimit(ip: string): RateLimitResult {
  return checkKeyedRateLimit(`ip:${ip}`, getDailyLimit(), DAY_IN_MS);
}

/** GET job poll limit per IP (default 60/min). */
export function checkPollRateLimit(ip: string): RateLimitResult {
  return checkKeyedRateLimit(
    `get:${ip}`,
    getPollLimitPerMinute(),
    60 * 1000,
  );
}

export async function verifyTurnstile(token: string, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return {
      success: process.env.NODE_ENV !== "production",
      reason: "missing-secret",
    };
  }
  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (ip !== "unknown") formData.append("remoteip", ip);
  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    body: formData,
  });
  const data = (await response.json()) as TurnstileResponse;
  return {
    success: data.success,
    reason: data["error-codes"]?.join(",") ?? "verification-failed",
  };
}

/**
 * content-review gate shape: allowlisted IPs skip Turnstile + daily limit.
 * Returns a result object; callers map to HTTP responses.
 */
export async function gateIntake(options: {
  ip: string;
  turnstileToken: string;
}): Promise<
  | {
      ok: true;
      admin: boolean;
      rateLimit: RateLimitResult | null;
    }
  | {
      ok: false;
      status: 403 | 429;
      error: string;
      rateLimit?: RateLimitResult;
    }
> {
  const { ip, turnstileToken } = options;

  if (isAllowlisted(ip)) {
    return { ok: true, admin: true, rateLimit: null };
  }

  const token = turnstileToken.trim();
  const hasTurnstileSecret = Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
  // Local/dev without Turnstile configured: allow empty token (same spirit as
  // verifyTurnstile missing-secret bypass). Production always requires a token.
  if (!token) {
    if (process.env.NODE_ENV === "production" || hasTurnstileSecret) {
      return {
        ok: false,
        status: 403,
        error: "Complete the Cloudflare Turnstile check.",
      };
    }
  } else {
    const verification = await verifyTurnstile(token, ip);
    if (!verification.success) {
      return {
        ok: false,
        status: 403,
        error: "Cloudflare Turnstile verification failed.",
      };
    }
  }

  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: "Daily demo limit reached.",
      rateLimit,
    };
  }

  return { ok: true, admin: false, rateLimit };
}
