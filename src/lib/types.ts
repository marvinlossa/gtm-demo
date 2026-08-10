export type PresentValue = "true" | "false" | "unknown";

export type ProfileAttribute = {
  id: string;
  label: string;
  description: string;
  weight: number;
  researchPrompt: string;
  positiveSignals: string[];
  negativeSignals: string[];
};

export type Profile = {
  id: string;
  name: string;
  description: string;
  version: number;
  attributes: ProfileAttribute[];
};

/** Public list card (no research prompts). */
export type ProfileSummary = {
  id: string;
  name: string;
  description: string;
  version: number;
  attributeCount: number;
  attributeLabels: string[];
};

export type EvidenceItem = {
  snippet: string;
  sourceUrl?: string;
  publishedAt?: string | null;
};

export type AttributeFinding = {
  attributeId: string;
  present: PresentValue;
  confidence: number;
  scoreHint: number;
  evidence: EvidenceItem[];
  notes?: string;
};

export type ResearchFindingsPayload = {
  findings: AttributeFinding[];
};

export type SalesStrategy = {
  summary: string;
  whyNow: string[];
  entryPoints: string[];
  talkTracks: Array<{
    title: string;
    script: string;
    tiedAttributeIds: string[];
  }>;
  discoveryQuestions: string[];
  risksAndObjections: string[];
  nextSteps: string[];
};

export type FitBand =
  | "Strong fit"
  | "Moderate fit"
  | "Weak fit"
  | "Poor fit"
  | "Insufficient data";

export type ScoredAttribute = {
  attributeId: string;
  label: string;
  weight: number;
  present: PresentValue;
  confidence: number;
  scoreHint: number;
  attributeScore: number;
  evidence: EvidenceItem[];
  notes?: string;
};

export type ScoredResult = {
  scoringVersion: "scoring.v1";
  overallScore: number;
  fitBand: FitBand;
  displayScore: number;
  confidenceOverall: number;
  unknownRatio: number;
  knownRatio: number;
  attributes: ScoredAttribute[];
  limitations: string[];
};

export type JobStatus = "pending" | "running" | "complete" | "failed";
