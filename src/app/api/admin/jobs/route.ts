import { NextRequest, NextResponse } from "next/server";
import { getClientIp, isAllowlisted } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getJob, getJobResult, toPublicJob } from "@/lib/jobs";

export const runtime = "nodejs";

/**
 * Debug: list recent jobs or fetch one by id.
 * Allowlisted IPs only (same ADMIN_IP_ALLOWLIST as demo gate).
 *
 * GET /api/admin/jobs
 * GET /api/admin/jobs?id=<uuid>
 * GET /api/admin/jobs?domain=biocryst.com&limit=10
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!isAllowlisted(ip)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  const domain = request.nextUrl.searchParams.get("domain")?.trim();
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 100)
    : 20;

  if (id) {
    const job = getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const result = job.status === "complete" ? getJobResult(job.id) : null;
    return NextResponse.json({
      job: toPublicJob(job, result),
      raw: job,
    });
  }

  const db = getDb();
  const rows = domain
    ? (db
        .prepare(
          `SELECT id, domain, profile_id, status, stage, error,
                  n8n_execution_id, created_at, updated_at, completed_at
           FROM jobs
           WHERE domain LIKE ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(`%${domain}%`, limit) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT id, domain, profile_id, status, stage, error,
                  n8n_execution_id, created_at, updated_at, completed_at
           FROM jobs
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>);

  return NextResponse.json({
    count: rows.length,
    jobs: rows.map((j) => ({
      id: j.id,
      domain: j.domain,
      profileId: j.profile_id,
      status: j.status,
      stage: j.stage,
      error: j.error,
      n8nExecutionId: j.n8n_execution_id,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
      completedAt: j.completed_at,
    })),
  });
}
