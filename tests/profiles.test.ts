import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeDb, resetDb } from "../src/lib/db";
import {
  getProfile,
  listProfiles,
  loadProfilesFromDisk,
  seedProfiles,
  validateProfile,
} from "../src/lib/profiles";

describe("seed profiles", () => {
  before(() => {
    resetDb(":memory:");
  });

  after(() => {
    closeDb();
  });

  it("loads three valid profiles from disk with weights ≈ 1", () => {
    const profiles = loadProfilesFromDisk();
    assert.equal(profiles.length, 3);
    const ids = new Set(profiles.map((p) => p.id));
    assert.ok(ids.has("sales-expansion"));
    assert.ok(ids.has("product-led-growth"));
    assert.ok(ids.has("enterprise-it-modernization"));
    for (const p of profiles) {
      const sum = p.attributes.reduce((s, a) => s + a.weight, 0);
      assert.ok(Math.abs(sum - 1) < 0.001, `${p.id} weight sum ${sum}`);
      assert.ok(p.attributes.length >= 4);
      for (const a of p.attributes) {
        assert.ok(a.researchPrompt.includes("{domain}") || a.researchPrompt.length > 20);
        assert.ok(a.positiveSignals.length >= 2);
        assert.ok(a.negativeSignals.length >= 1);
      }
    }
  });

  it("seeds into SQLite and can be listed", () => {
    const db = resetDb(":memory:");
    const seeded = seedProfiles(db);
    assert.equal(seeded.length, 3);
    const listed = listProfiles(db);
    assert.equal(listed.length, 3);
    const sales = getProfile(db, "sales-expansion");
    assert.ok(sales);
    assert.equal(sales!.attributes.length, 7);
  });

  it("rejects bad weights", () => {
    assert.throws(
      () =>
        validateProfile({
          id: "bad",
          name: "Bad",
          description: "x",
          version: 1,
          attributes: [
            {
              id: "a1",
              label: "A",
              description: "d",
              weight: 0.5,
              researchPrompt: "r {domain}",
              positiveSignals: ["p1", "p2"],
              negativeSignals: ["n1"],
            },
            {
              id: "a2",
              label: "B",
              description: "d",
              weight: 0.3,
              researchPrompt: "r {domain}",
              positiveSignals: ["p1", "p2"],
              negativeSignals: ["n1"],
            },
            {
              id: "a3",
              label: "C",
              description: "d",
              weight: 0.1,
              researchPrompt: "r {domain}",
              positiveSignals: ["p1", "p2"],
              negativeSignals: ["n1"],
            },
            {
              id: "a4",
              label: "D",
              description: "d",
              weight: 0.05,
              researchPrompt: "r {domain}",
              positiveSignals: ["p1", "p2"],
              negativeSignals: ["n1"],
            },
          ],
        }),
      /weights sum/,
    );
  });
});
