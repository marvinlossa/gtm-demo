import { timingSafeEqual } from "node:crypto";

export function verifyCallbackSecret(headerValue: string | null): boolean {
  const secret = process.env.GTM_CALLBACK_SECRET?.trim();
  if (!secret) {
    // Allow mock-local without secret when MOCK_N8N is on and not production.
    const mock =
      (process.env.MOCK_N8N ?? "1").trim().toLowerCase() === "1" ||
      process.env.MOCK_N8N === "true";
    if (mock && process.env.NODE_ENV !== "production") return true;
    return false;
  }

  if (!headerValue) return false;
  const expected = headerValue.startsWith("Bearer ")
    ? headerValue.slice(7).trim()
    : headerValue.trim();

  const a = Buffer.from(expected);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
