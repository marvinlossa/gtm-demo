/** Client-side display model for the prospect report (sample + live jobs). */

export type BuyingSignalLevel = "High" | "Medium" | "Low";
export type PriorityLevel = "High" | "Medium" | "Low";
export type RecommendationVerdict = "Pursue" | "Monitor" | "Low priority";

export type DisplayAttribute = {
  id: string;
  label: string;
  score: number;
  present: string;
  confidence: number;
  evidence: string;
  sourceLabel?: string;
  sourceUrl?: string;
};

export type DisplayResult = {
  domain: string;
  profileLabel: string;
  overallScore: number;
  fitBand: string;
  buyingSignal: BuyingSignalLevel;
  priority: PriorityLevel;
  recommendation: RecommendationVerdict;
  recommendationBlurb: string;
  attributes: DisplayAttribute[];
  whyNowNarrative: string;
  whyNowSignals: Array<{ title: string; detail: string }>;
  whoToApproach: string;
  whoToApproachWhy: string;
  alternativeContact?: string;
  likelyChallenge: string;
  salesAngle: string;
  conversationStarter: string;
  limitations?: string[];
  mock?: boolean;
};

const TIMING_ATTRIBUTE_IDS = new Set([
  "growing-sales-team",
  "new-market-expansion",
  "recent-funding",
  "outbound-motion",
  "ai-initiatives",
  "hiring-signals",
]);

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return "High confidence";
  if (confidence >= 0.45) return "Medium confidence";
  return "Low confidence";
}

export function evidenceStrength(present: string, confidence: number): string {
  if (present === "true" && confidence >= 0.7) return "Strong evidence";
  if (present === "true") return "Some evidence";
  if (present === "false") return "Counter-signal";
  return "Limited evidence";
}

export function humanSourceLabel(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("careers") || url.includes("/careers")) {
      return "Company careers page";
    }
    if (url.includes("blog") || url.includes("news") || url.includes("press")) {
      return "Company announcement";
    }
    return host;
  } catch {
    return "Public source";
  }
}

export function deriveBuyingSignal(input: {
  overallScore: number;
  fitBand: string;
  attributes: DisplayAttribute[];
  whyNowCount: number;
}): BuyingSignalLevel {
  if (input.fitBand === "Insufficient data") return "Low";

  const timingHits = input.attributes.filter(
    (a) =>
      a.present === "true" &&
      a.confidence >= 0.5 &&
      (TIMING_ATTRIBUTE_IDS.has(a.id) ||
        /hir|fund|expand|growth|market/i.test(a.label)),
  ).length;

  if (
    input.overallScore >= 65 &&
    (input.whyNowCount >= 2 || timingHits >= 2)
  ) {
    return "High";
  }
  if (
    input.overallScore >= 50 ||
    input.whyNowCount >= 1 ||
    timingHits >= 1
  ) {
    return "Medium";
  }
  return "Low";
}

export function derivePriority(input: {
  overallScore: number;
  fitBand: string;
  buyingSignal: BuyingSignalLevel;
}): PriorityLevel {
  if (input.fitBand === "Insufficient data") return "Low";
  if (input.overallScore >= 70 && input.buyingSignal !== "Low") return "High";
  if (input.overallScore >= 70) return "Medium";
  if (input.overallScore >= 55 && input.buyingSignal === "High") return "High";
  if (input.overallScore >= 55) return "Medium";
  if (input.overallScore >= 40 && input.buyingSignal === "High") return "Medium";
  return "Low";
}

export function deriveRecommendation(input: {
  overallScore: number;
  fitBand: string;
  buyingSignal: BuyingSignalLevel;
  priority: PriorityLevel;
}): { verdict: RecommendationVerdict; blurb: string } {
  if (input.fitBand === "Insufficient data") {
    return {
      verdict: "Low priority",
      blurb:
        "Public evidence is too thin to justify focused outreach on this company yet.",
    };
  }
  if (input.priority === "High" && input.buyingSignal !== "Low") {
    return {
      verdict: "Pursue",
      blurb:
        "Strong prospect fit and current buying signals make this company worth approaching now.",
    };
  }
  if (input.overallScore >= 55 && input.buyingSignal === "Low") {
    return {
      verdict: "Monitor",
      blurb:
        "The company matches the target profile, but there is no strong reason to initiate outreach yet.",
    };
  }
  if (input.overallScore >= 55) {
    return {
      verdict: "Pursue",
      blurb:
        "Solid prospect fit with enough public signals to justify a thoughtful first approach.",
    };
  }
  if (input.overallScore >= 40 && input.buyingSignal === "High") {
    return {
      verdict: "Monitor",
      blurb:
        "Timing looks interesting, but overall fit with the selected profile is only moderate — validate before investing heavily.",
    };
  }
  return {
    verdict: "Low priority",
    blurb:
      "Current evidence suggests limited fit with the selected target profile.",
  };
}

/**
 * Client-only sample so visitors can see a full report without burning quota.
 * Framed as seller → prospect (reader analyzes a potential client).
 */
export const SAMPLE_RESULT: DisplayResult = {
  domain: "northwind-analytics.com",
  profileLabel: "GTM Scale-Up",
  overallScore: 84,
  fitBand: "Strong fit",
  buyingSignal: "High",
  priority: "High",
  recommendation: "Pursue",
  recommendationBlurb:
    "Strong prospect fit and current buying signals make this company worth approaching now.",
  attributes: [
    {
      id: "growing-sales-team",
      label: "Growing sales team",
      score: 86,
      present: "true",
      confidence: 0.85,
      evidence:
        "Careers lists AE and SDR openings in the US and EMEA; a blog post notes GTM headcount growth after the raise.",
      sourceLabel: "Company careers page",
      sourceUrl: "https://northwind-analytics.com/careers",
    },
    {
      id: "new-market-expansion",
      label: "New market expansion",
      score: 80,
      present: "true",
      confidence: 0.78,
      evidence:
        "Press notes recent expansion into two European markets with localized pricing pages.",
      sourceLabel: "Company announcement",
      sourceUrl: "https://northwind-analytics.com/press",
    },
    {
      id: "recent-funding",
      label: "Recent funding",
      score: 90,
      present: "true",
      confidence: 0.9,
      evidence:
        "Series B announcement cites a growth fund and plans to scale go-to-market.",
      sourceLabel: "Company announcement",
      sourceUrl: "https://northwind-analytics.com/press/series-b",
    },
    {
      id: "b2b-offering",
      label: "B2B offering",
      score: 92,
      present: "true",
      confidence: 0.92,
      evidence:
        "Team and enterprise pricing plus case studies aimed at mid-market analytics buyers.",
      sourceLabel: "Company website",
      sourceUrl: "https://northwind-analytics.com/pricing",
    },
    {
      id: "clear-sales-org",
      label: "Clear sales organization",
      score: 72,
      present: "true",
      confidence: 0.7,
      evidence:
        "Leadership page lists a VP of Sales; enterprise page describes AE-led evaluation.",
      sourceLabel: "Company website",
      sourceUrl: "https://northwind-analytics.com/about",
    },
  ],
  whyNowNarrative:
    "The company is expanding into two new markets while actively hiring commercial roles, suggesting its GTM operation is entering a new growth phase.",
  whyNowSignals: [
    {
      title: "Sales hiring",
      detail: "Multiple commercial roles currently advertised across regions.",
    },
    {
      title: "Market expansion",
      detail: "Recently entered two European markets with localized pages.",
    },
    {
      title: "Funding for GTM",
      detail: "Series B framed as capital to scale go-to-market capacity.",
    },
  ],
  whoToApproach: "VP Sales / Head of Revenue Operations",
  whoToApproachWhy:
    "Likely owner of the processes affected by the company’s current commercial expansion.",
  alternativeContact: "COO",
  likelyChallenge:
    "Rapid commercial growth may be increasing the amount of manual prospect research, qualification and sales operations work required from the team.",
  salesAngle:
    "Position AI-assisted prospect research as a way to scale outbound activity without increasing repetitive research work at the same rate as headcount.",
  conversationStarter:
    "“I noticed you’re expanding the commercial team while entering additional European markets. At that stage, prospect research and qualification often become increasingly manual. We’ve been working on ways to automate that part of the GTM workflow…”",
  limitations: [
    "Illustrative sample only — not live research.",
    "Public-web estimate style; not investment or legal advice.",
  ],
};

export type JobStrategyPayload = {
  summary?: string;
  whyNow?: string[];
  entryPoints?: string[];
  talkTracks?: Array<{ title?: string; script?: string } | string>;
  discoveryQuestions?: string[];
  risksAndObjections?: string[];
  nextSteps?: string[];
};

export function buildDisplayResult(input: {
  domain: string;
  profileLabel: string;
  overallScore: number;
  fitBand: string;
  attributes: DisplayAttribute[];
  strategy: JobStrategyPayload;
  limitations?: string[];
}): DisplayResult {
  const whyNow = input.strategy.whyNow ?? [];
  const buyingSignal = deriveBuyingSignal({
    overallScore: input.overallScore,
    fitBand: input.fitBand,
    attributes: input.attributes,
    whyNowCount: whyNow.length,
  });
  const priority = derivePriority({
    overallScore: input.overallScore,
    fitBand: input.fitBand,
    buyingSignal,
  });
  const { verdict, blurb } = deriveRecommendation({
    overallScore: input.overallScore,
    fitBand: input.fitBand,
    buyingSignal,
    priority,
  });

  const talkScripts = (input.strategy.talkTracks ?? [])
    .map((t) => {
      if (typeof t === "string") return t;
      return t.script ?? t.title ?? "";
    })
    .filter(Boolean);

  const entryPoints = input.strategy.entryPoints ?? [];
  const whoToApproach =
    entryPoints[0] ||
    "Sales or revenue leadership at the prospect (validate titles publicly)";
  const alternativeContact = entryPoints[1];

  const whyNowNarrative =
    whyNow[0] ||
    input.strategy.summary ||
    "Public signals are mixed — treat timing as a hypothesis until a discovery conversation.";

  const whyNowSignals: Array<{ title: string; detail: string }> = whyNow
    .slice(0, 4)
    .map((detail, i) => ({
      title: i === 0 ? "Timing signal" : `Signal ${i + 1}`,
      detail,
    }));

  // Prefer attribute-backed signals when whyNow is sparse
  if (whyNowSignals.length < 2) {
    for (const attr of input.attributes) {
      if (attr.present !== "true" || whyNowSignals.length >= 4) continue;
      if (
        TIMING_ATTRIBUTE_IDS.has(attr.id) ||
        /hir|fund|expand|growth|market/i.test(attr.label)
      ) {
        whyNowSignals.push({
          title: attr.label,
          detail: attr.evidence,
        });
      }
    }
  }

  const likelyChallenge =
    input.strategy.risksAndObjections?.[0] ||
    "Public data cannot confirm internal priorities — treat the challenge below as a working hypothesis for outreach.";

  const salesAngle =
    talkScripts[0] ||
    input.strategy.summary ||
    "Open on the strongest public signal and connect it to a narrow, low-risk pilot the prospect can accept.";

  const conversationStarter =
    talkScripts.find((t) => t.includes("“") || t.includes('"') || t.length > 80) ||
    talkScripts[0] ||
    "Reference one public growth signal, ask whether it is creating capacity pressure, and offer a short comparison of how peers handle that stage.";

  return {
    domain: input.domain,
    profileLabel: input.profileLabel,
    overallScore: input.overallScore,
    fitBand: input.fitBand,
    buyingSignal,
    priority,
    recommendation: verdict,
    recommendationBlurb: blurb,
    attributes: input.attributes,
    whyNowNarrative,
    whyNowSignals: whyNowSignals.slice(0, 4),
    whoToApproach,
    whoToApproachWhy:
      "Role most likely to own the processes and tools affected by the signals above.",
    alternativeContact,
    likelyChallenge,
    salesAngle,
    conversationStarter,
    limitations: input.limitations,
  };
}
