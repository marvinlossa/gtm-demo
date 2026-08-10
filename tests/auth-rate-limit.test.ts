import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  checkKeyedRateLimit,
  checkRateLimit,
} from "../src/lib/auth";
import { closeDb, resetDb } from "../src/lib/db";

describe("SQLite rate limits", () => {
  beforeEach(() => {
    process.env.INTAKE_DAILY_LIMIT = "2";
    resetDb(":memory:");
  });

  afterEach(() => {
    closeDb();
  });

  it("allows up to the daily limit then blocks", () => {
    const key = `test-ip-${Date.now()}`;
    const first = checkKeyedRateLimit(key, 2, 60_000);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 1);

    const second = checkKeyedRateLimit(key, 2, 60_000);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);

    const third = checkKeyedRateLimit(key, 2, 60_000);
    assert.equal(third.allowed, false);
    assert.equal(third.remaining, 0);
  });

  it("checkRateLimit uses intake env limit", () => {
    const ip = `unit-test-${Math.random().toString(16).slice(2)}`;
    const a = checkRateLimit(ip);
    const b = checkRateLimit(ip);
    const c = checkRateLimit(ip);
    assert.equal(a.limit, 2);
    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
    assert.equal(c.allowed, false);
  });
});
