import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDb, resetDb } from "../src/lib/db";
import {
  createJob,
  getJob,
  getJobResult,
  markJobFailed,
  markJobRunning,
} from "../src/lib/jobs";
import { processCallback } from "../src/lib/process-callback";
import { JOB_ERROR_TIMEOUT } from "../src/lib/constants";

const fixturePath = path.join(
  process.cwd(),
  "data/fixtures/callback-complete.json",
);

describe("jobs callback lifecycle", () => {
  beforeEach(() => {
    resetDb(":memory:");
  });

  afterEach(() => {
    closeDb();
  });

  it("completes a running job from fixture and scores", () => {
    const job = createJob({
      domain: "example.com",
      normalizedUrl: "https://example.com",
      profileId: "sales-expansion",
      clientIp: "1.1.1.1",
    });
    markJobRunning(job.id);

    const body = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown;
    const result = processCallback(job.id, body);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.job.status, "complete");
    const stored = getJobResult(job.id);
    assert.ok(stored);
    assert.ok(stored!.overall_score >= 0 && stored!.overall_score <= 100);
    assert.ok(stored!.fit_band.length > 0);
    const strategy = JSON.parse(stored!.strategy_json) as { summary: string };
    assert.ok(strategy.summary.includes("Lead with"));
  });

  it("recovers JOB_TIMEOUT failed jobs on late complete", () => {
    const job = createJob({
      domain: "example.com",
      normalizedUrl: "https://example.com",
      profileId: "sales-expansion",
      clientIp: "1.1.1.1",
    });
    markJobRunning(job.id);
    markJobFailed(job.id, JOB_ERROR_TIMEOUT);

    const body = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown;
    const result = processCallback(job.id, body);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.recovered, true);
    assert.equal(getJob(job.id)?.status, "complete");
  });

  it("ignores complete upgrade when failed for other reasons", () => {
    const job = createJob({
      domain: "example.com",
      normalizedUrl: "https://example.com",
      profileId: "sales-expansion",
      clientIp: "1.1.1.1",
    });
    markJobRunning(job.id);
    markJobFailed(job.id, "RESEARCH_JSON_PARSE");

    const body = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown;
    const result = processCallback(job.id, body);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.noop, true);
    assert.equal(getJob(job.id)?.status, "failed");
  });

  it("rejects invalid complete payload", () => {
    const job = createJob({
      domain: "example.com",
      normalizedUrl: "https://example.com",
      profileId: "sales-expansion",
      clientIp: "1.1.1.1",
    });
    markJobRunning(job.id);
    const result = processCallback(job.id, { status: "complete" });
    assert.equal(result.ok, false);
    assert.equal(getJob(job.id)?.status, "failed");
    assert.equal(getJob(job.id)?.error, "CALLBACK_VALIDATION");
  });
});
