import { isIP } from "node:net";

/**
 * Public URL / domain guards adapted from Content Brief Creator
 * (`ContentBriefCreator/src/lib/research/url.ts`).
 */

function isPrivateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIpv6(host: string) {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
}

export function normalizePublicHttpUrl(input: unknown) {
  if (typeof input !== "string") {
    throw new Error("Enter a public website URL or domain.");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a public website URL or domain.");
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid public website URL or domain.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost websites are not supported.");
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4(hostname)) {
    throw new Error("Private network websites are not supported.");
  }
  if (ipVersion === 6 && isPrivateIpv6(hostname)) {
    throw new Error("Private network websites are not supported.");
  }
  if (!ipVersion && !hostname.includes(".")) {
    throw new Error("Enter a public domain name.");
  }
  return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
}

export function domainFromUrl(value: string) {
  return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
}

/** Normalize domain-or-URL input to { normalizedUrl, domain }. */
export function parseCompanyInput(input: unknown) {
  const normalizedUrl = normalizePublicHttpUrl(input);
  return {
    normalizedUrl,
    domain: domainFromUrl(normalizedUrl),
  };
}
