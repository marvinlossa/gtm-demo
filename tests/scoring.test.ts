import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadProfilesFromDisk } from "../src/lib/profiles";
import { scoreFindings } from "../src/lib/scoring";
import type { Profile } from "../src/lib/types";

function miniProfile(): Profile {
  return {
    id: "mini",
    name: "Mini",
    description: "test",
    version: 1,
    attributes: [
      {
        id: "a",
        label: "A",
        description: "A",
        weight: 0.5,
        researchPrompt: "p",
        positiveSignals: ["x", "y"],
        negativeSignals: ["z"],
      },
      {
        id: "b",
        label: "B",
        description: "B",
        weight: 0.5,
        researchPrompt: "p",
        positiveSignals: ["x", "y"],
        negativeSignals: ["z"],
      },
    ],
  };
}

describe("scoring.v1", () => {
  it("all true high conf → high overall, Strong or Moderate", () => {
    const profile = miniProfile();
    const result = scoreFindings(profile, [
      {
        attributeId: "a",
        present: "true",
        confidence: 1,
        scoreHint: 90,
        evidence: [
          { snippet: "Evidence one for A" },
          { snippet: "Evidence two for A" },
        ],
      },
      {
        attributeId: "b",
        present: true, // boolean coercion
        confidence: 1,
        scoreHint: 90,
        evidence: [
          { snippet: "Evidence one for B" },
          { snippet: "Evidence two for B" },
        ],
      },
    ]);
    assert.equal(result.scoringVersion, "scoring.v1");
    assert.ok(result.overallScore >= 80, `score ${result.overallScore}`);
    assert.ok(
      result.fitBand === "Strong fit" || result.fitBand === "Moderate fit",
    );
    assert.ok(result.unknownRatio < 0.5);
  });

  it("all unknown conf 0 → Insufficient data, low overall", () => {
    const profile = miniProfile();
    const result = scoreFindings(profile, []);
    assert.equal(result.fitBand, "Insufficient data");
    assert.equal(result.unknownRatio, 1);
    assert.ok(result.overallScore <= 30);
    assert.ok(
      result.limitations.some((l) => l.includes("Limited public evidence")),
    );
  });

  it("present false high hint → scoreHint coerced ≤35, low attr score", () => {
    const profile = miniProfile();
    const result = scoreFindings(profile, [
      {
        attributeId: "a",
        present: "false",
        confidence: 1,
        scoreHint: 90,
        evidence: [{ snippet: "Contradictory high hint" }],
      },
      {
        attributeId: "b",
        present: "false",
        confidence: 1,
        scoreHint: 90,
        evidence: [{ snippet: "Also false" }],
      },
    ]);
    for (const attr of result.attributes) {
      assert.ok(attr.scoreHint <= 35, `hint ${attr.scoreHint}`);
      assert.ok(attr.attributeScore <= 40, `score ${attr.attributeScore}`);
    }
    assert.ok(result.overallScore < 50);
  });

  it("boolean present coerces to true", () => {
    const profile = miniProfile();
    const result = scoreFindings(profile, [
      {
        attributeId: "a",
        present: true,
        confidence: 0.9,
        scoreHint: 80,
        evidence: [{ snippet: "yes" }],
      },
      {
        attributeId: "b",
        present: false,
        confidence: 0.9,
        scoreHint: 10,
        evidence: [{ snippet: "no" }],
      },
    ]);
    assert.equal(result.attributes.find((a) => a.attributeId === "a")?.present, "true");
    assert.equal(result.attributes.find((a) => a.attributeId === "b")?.present, "false");
  });

  it("missing attribute filled as unknown", () => {
    const profile = miniProfile();
    const result = scoreFindings(profile, [
      {
        attributeId: "a",
        present: "true",
        confidence: 1,
        scoreHint: 80,
        evidence: [{ snippet: "only a" }, { snippet: "more" }],
      },
    ]);
    const b = result.attributes.find((a) => a.attributeId === "b");
    assert.ok(b);
    assert.equal(b!.present, "unknown");
    assert.equal(b!.confidence, 0);
  });

  it("weights produce overall in 0–100 on real sales-expansion profile", () => {
    const sales = loadProfilesFromDisk().find((p) => p.id === "sales-expansion");
    assert.ok(sales);
    const findings = sales!.attributes.map((a, i) => ({
      attributeId: a.id,
      present: "true" as const,
      confidence: 0.8,
      scoreHint: 70 + (i % 3) * 5,
      evidence: [{ snippet: `Signal for ${a.id}` }, { snippet: "second" }],
    }));
    const result = scoreFindings(sales!, findings);
    assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
    assert.equal(result.attributes.length, sales!.attributes.length);
    assert.notEqual(result.fitBand, "Insufficient data");
  });

  it("hard-fail renormalizes remaining weights", () => {
    const profile = miniProfile();
    const result = scoreFindings(
      profile,
      [
        {
          attributeId: "a",
          present: "true",
          confidence: 1,
          scoreHint: 100,
          evidence: [{ snippet: "a1" }, { snippet: "a2" }],
        },
      ],
      { hardFailedAttributeIds: ["b"] },
    );
    assert.equal(result.attributes.length, 1);
    assert.equal(result.attributes[0].attributeId, "a");
    assert.ok(result.overallScore >= 90);
  });
});
