import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  checkIntakeLimits,
  checkKeyedRateLimit,
  checkRateLimit,
} from "../src/lib/auth";
import { closeDb, getDb, resetDb } from "../src/lib/db";

describe("SQLite rate limits", () => {
  beforeEach(() => {
    process.env.INTAKE_DAILY_LIMIT = "2";
    process.env.INTAKE_LIFETIME_LIMIT = "4";
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

  it("checkIntakeLimits enforces daily then lifetime", () => {
    process.env.INTAKE_DAILY_LIMIT = "2";
    process.env.INTAKE_LIFETIME_LIMIT = "3";
    const ip = `intake-${Math.random().toString(16).slice(2)}`;

    assert.equal(checkIntakeLimits(ip).allowed, true);
    assert.equal(checkIntakeLimits(ip).allowed, true);
    const dailyBlock = checkIntakeLimits(ip);
    assert.equal(dailyBlock.allowed, false);
    assert.equal(dailyBlock.kind, "daily");

    // Simulate next day: clear daily counter while lifetime remains.
    getDb().prepare("DELETE FROM rate_limits WHERE key = ?").run(`ip:${ip}`);

    assert.equal(checkIntakeLimits(ip).allowed, true); // lifetime 3rd of 3
    const lifeBlock = checkIntakeLimits(ip);
    assert.equal(lifeBlock.allowed, false);
    assert.equal(lifeBlock.kind, "lifetime");
    assert.equal(lifeBlock.limit, 3);
  });
});
