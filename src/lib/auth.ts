import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
/** Far-future window so lifetime counters are not cleaned up as “expired”. */
const LIFETIME_WINDOW_MS = 100 * 365.25 * DAY_IN_MS;
const DEFAULT_DAILY_LIMIT = 2;
const DEFAULT_LIFETIME_LIMIT = 4;
const DEFAULT_GET_LIMIT_PER_MIN = 60;

type TurnstileResponse = { success: boolean; "error-codes"?: string[] };

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  /** Which quota denied the request (when allowed is false). */
  kind?: "daily" | "lifetime";
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

function getLifetimeLimit() {
  const parsed = Number(process.env.INTAKE_LIFETIME_LIMIT);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LIFETIME_LIMIT;
}

function getPollLimitPerMinute() {
  const parsed = Number(process.env.GET_POLL_LIMIT_PER_MIN);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_GET_LIMIT_PER_MIN;
}

type RateLimitRow = { key: string; count: number; reset_at: number };

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

  // Do not wipe far-future lifetime keys.
  db.prepare(
    "DELETE FROM rate_limits WHERE reset_at <= ? AND key NOT LIKE 'lifetime:%'",
  ).run(now);

  const existing = db
    .prepare("SELECT key, count, reset_at FROM rate_limits WHERE key = ?")
    .get(key) as RateLimitRow | undefined;

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

function readKeyedCount(
  key: string,
  now: number,
): { count: number; resetAt: number; fresh: boolean } {
  const db = getDb();
  const existing = db
    .prepare("SELECT key, count, reset_at FROM rate_limits WHERE key = ?")
    .get(key) as RateLimitRow | undefined;
  if (!existing || existing.reset_at <= now) {
    return { count: 0, resetAt: 0, fresh: true };
  }
  return { count: existing.count, resetAt: existing.reset_at, fresh: false };
}

function writeKeyedCount(key: string, count: number, resetAt: number) {
  const db = getDb();
  db.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at`,
  ).run(key, count, resetAt);
}

/**
 * Daily + lifetime intake quotas for one IP.
 * Increments both only when the request is allowed (avoids burning lifetime on a daily block).
 */
export function checkIntakeLimits(ip: string): RateLimitResult {
  const db = getDb();
  const now = Date.now();
  const dailyLimit = getDailyLimit();
  const lifetimeLimit = getLifetimeLimit();
  const dailyKey = `ip:${ip}`;
  const lifetimeKey = `lifetime:${ip}`;

  db.prepare(
    "DELETE FROM rate_limits WHERE reset_at <= ? AND key NOT LIKE 'lifetime:%'",
  ).run(now);

  const daily = readKeyedCount(dailyKey, now);
  const lifetime = readKeyedCount(lifetimeKey, now);

  const dailyResetAt = daily.fresh ? now + DAY_IN_MS : daily.resetAt;
  const lifetimeResetAt = lifetime.fresh
    ? now + LIFETIME_WINDOW_MS
    : lifetime.resetAt;

  if (lifetime.count >= lifetimeLimit) {
    return {
      allowed: false,
      limit: lifetimeLimit,
      remaining: 0,
      resetAt: lifetimeResetAt,
      kind: "lifetime",
    };
  }
  if (daily.count >= dailyLimit) {
    return {
      allowed: false,
      limit: dailyLimit,
      remaining: 0,
      resetAt: dailyResetAt,
      kind: "daily",
    };
  }

  const nextDaily = daily.count + 1;
  const nextLifetime = lifetime.count + 1;
  // Single transaction so both counters move together.
  const tx = db.transaction(() => {
    writeKeyedCount(dailyKey, nextDaily, dailyResetAt);
    writeKeyedCount(lifetimeKey, nextLifetime, lifetimeResetAt);
  });
  tx();

  return {
    allowed: true,
    limit: dailyLimit,
    remaining: dailyLimit - nextDaily,
    resetAt: dailyResetAt,
  };
}

/** Intake daily limit per client IP (default 2). Prefer checkIntakeLimits for gate. */
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

  const rateLimit = checkIntakeLimits(ip);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error:
        rateLimit.kind === "lifetime"
          ? "Demo lifetime limit reached for this project."
          : "Daily demo limit reached.",
      rateLimit,
    };
  }

  return { ok: true, admin: false, rateLimit };
}
