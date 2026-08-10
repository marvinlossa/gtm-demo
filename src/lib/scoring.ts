import type {
  AttributeFinding,
  EvidenceItem,
  FitBand,
  PresentValue,
  Profile,
  ScoredAttribute,
  ScoredResult,
} from "@/lib/types";

export const SCORING_VERSION = "scoring.v1" as const;

export type ScoreFindingsOptions = {
  /** Reserved: drop these attributes and renormalize remaining weights. */
  hardFailedAttributeIds?: string[];
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function coercePresent(value: unknown): PresentValue {
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "false" || normalized === "unknown") {
      return normalized;
    }
  }
  return "unknown";
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function coerceEvidence(raw: unknown): EvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: EvidenceItem[] = [];
  for (const entry of raw.slice(0, 5)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.snippet !== "string" || !e.snippet.trim()) continue;
    const item: EvidenceItem = {
      snippet: e.snippet.trim().slice(0, 500),
    };
    if (typeof e.sourceUrl === "string" && isHttpsUrl(e.sourceUrl.trim())) {
      item.sourceUrl = e.sourceUrl.trim();
    }
    if (e.publishedAt === null) {
      item.publishedAt = null;
    } else if (typeof e.publishedAt === "string") {
      item.publishedAt = e.publishedAt;
    }
    items.push(item);
  }
  return items;
}

function coerceFinding(
  raw: unknown,
  attributeId: string,
): AttributeFinding {
  if (!raw || typeof raw !== "object") {
    return {
      attributeId,
      present: "unknown",
      confidence: 0,
      scoreHint: 0,
      evidence: [],
    };
  }
  const f = raw as Record<string, unknown>;
  const present = coercePresent(f.present);
  const confidence = clamp(Number(f.confidence) || 0, 0, 1);
  let scoreHint = clamp(Number(f.scoreHint) || 0, 0, 100);
  const evidence = coerceEvidence(f.evidence);

  // Step 2 — inconsistent present vs scoreHint
  if (present === "false" && scoreHint > 35) {
    scoreHint = 35;
  }
  if (present === "true" && scoreHint < 40 && evidence.length >= 1) {
    scoreHint = Math.max(scoreHint, 40);
  }

  const notes =
    typeof f.notes === "string" ? f.notes.trim().slice(0, 500) : undefined;

  return {
    attributeId,
    present,
    confidence,
    scoreHint,
    evidence,
    notes: notes || undefined,
  };
}

function attributeScoreFromFinding(finding: AttributeFinding): number {
  let raw: number;
  if (finding.present === "true") {
    raw = finding.scoreHint;
  } else if (finding.present === "false") {
    raw = Math.min(finding.scoreHint, 35);
  } else {
    raw = 50 * finding.confidence;
  }

  const evidenceFactor =
    finding.evidence.length === 0
      ? 0.55
      : finding.evidence.length === 1
        ? 0.8
        : 1.0;

  return Math.round(
    clamp(raw * (0.5 + 0.5 * finding.confidence) * evidenceFactor, 0, 100),
  );
}

function fitBandFor(
  overallScore: number,
  unknownRatio: number,
): FitBand {
  if (unknownRatio >= 0.5) return "Insufficient data";
  if (overallScore >= 80) return "Strong fit";
  if (overallScore >= 60) return "Moderate fit";
  if (overallScore >= 40) return "Weak fit";
  return "Poor fit";
}

/**
 * Deterministic transparent scoring (scoring.v1).
 * Pure function — no I/O.
 */
export function scoreFindings(
  profile: Profile,
  rawFindings: unknown[],
  options: ScoreFindingsOptions = {},
): ScoredResult {
  const hardFailed = new Set(options.hardFailedAttributeIds ?? []);
  const activeAttributes = profile.attributes.filter(
    (a) => !hardFailed.has(a.id),
  );
  if (activeAttributes.length === 0) {
    throw new Error("No attributes left to score after hard-fails.");
  }

  const weightSum = activeAttributes.reduce((s, a) => s + a.weight, 0);
  if (weightSum <= 0) {
    throw new Error("Attribute weights must sum to a positive number.");
  }
  // Renormalize only when hard-fails removed weight (MVP path: no-op when sum≈1).
  const renorm = (w: number) => w / weightSum;

  const byId = new Map<string, unknown>();
  if (Array.isArray(rawFindings)) {
    for (const item of rawFindings) {
      if (!item || typeof item !== "object") continue;
      const id = (item as { attributeId?: unknown }).attributeId;
      if (typeof id === "string" && id) byId.set(id, item);
    }
  }

  const scored: ScoredAttribute[] = [];
  let overall = 0;
  let confidenceOverall = 0;
  let unknownCount = 0;

  for (const attr of activeAttributes) {
    const finding = coerceFinding(byId.get(attr.id), attr.id);
    if (finding.present === "unknown") unknownCount += 1;
    const attributeScore = attributeScoreFromFinding(finding);
    const weight = renorm(attr.weight);
    overall += attributeScore * weight;
    confidenceOverall += finding.confidence * weight;
    scored.push({
      attributeId: attr.id,
      label: attr.label,
      weight: attr.weight,
      present: finding.present,
      confidence: finding.confidence,
      scoreHint: finding.scoreHint,
      attributeScore,
      evidence: finding.evidence,
      notes: finding.notes,
    });
  }

  const overallScore = Math.round(clamp(overall, 0, 100));
  const unknownRatio = unknownCount / activeAttributes.length;
  const fitBand = fitBandFor(overallScore, unknownRatio);

  const limitations: string[] = [
    "Public-web estimate only — not investment, credit, or legal advice.",
  ];
  if (fitBand === "Insufficient data") {
    limitations.push(
      "Limited public evidence — score is not a reliable fit judgment.",
    );
  }
  if (hardFailed.size > 0) {
    limitations.push(
      `Hard-failed attributes excluded: ${[...hardFailed].join(", ")}.`,
    );
  }

  return {
    scoringVersion: SCORING_VERSION,
    overallScore,
    fitBand,
    displayScore: overallScore,
    confidenceOverall: clamp(confidenceOverall, 0, 1),
    unknownRatio,
    knownRatio: 1 - unknownRatio,
    attributes: scored,
    limitations,
  };
}
