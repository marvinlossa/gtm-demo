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

export type JobStrategyPayload = {
  summary?: string;
  whyNow?: string[];
  entryPoints?: string[];
  talkTracks?: Array<
    | { title?: string; script?: string; tiedAttributeIds?: string[] }
    | string
  >;
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

/**
 * Sample report for the walkthrough — based on a real live analysis of ramp.com
 * (GTM Scale-Up / sales-expansion), cached in the client so demos don’t re-spend API quota.
 * Framed as seller → prospect (reader analyzes a potential client).
 */
export const SAMPLE_RESULT: DisplayResult = buildDisplayResult({
  domain: "ramp.com",
  profileLabel: "GTM Scale-Up",
  overallScore: 86,
  fitBand: "Strong fit",
  attributes: [
    {
      id: "growing-sales-team",
      label: "Growing sales team",
      score: 86,
      present: "true",
      confidence: 0.9,
      evidence:
        "Careers lists multiple Account Executive, Strategic AE, and Enterprise AE roles; recent sales leadership hiring (Head of Enterprise Sales, VP of Sales).",
      sourceLabel: "Company careers page",
      sourceUrl: "https://ramp.com/careers",
    },
    {
      id: "new-market-expansion",
      label: "New market expansion",
      score: 79,
      present: "true",
      confidence: 0.85,
      evidence:
        "Corporate card and spend platform launched in Canada as a first major international market, with localized signup and support.",
      sourceLabel: "CNBC",
      sourceUrl:
        "https://www.cnbc.com/2024-06-19/ramp-launches-in-canada-for-businesses-to-track-spending-and-save-on-fees.html",
    },
    {
      id: "recent-funding",
      label: "Recent funding",
      score: 93,
      present: "true",
      confidence: 0.95,
      evidence:
        "Series D (~$300M, late 2023) led by Founders Fund; growth capital framed for product, sales, and international expansion.",
      sourceLabel: "TechCrunch",
      sourceUrl:
        "https://techcrunch.com/2023-11-15/ramp-raises-300-million-series-d-at-8-1-billion-valuation/",
    },
    {
      id: "b2b-offering",
      label: "B2B offering",
      score: 100,
      present: "true",
      confidence: 1,
      evidence:
        "Business spend management for mid-market and enterprise; team/enterprise plans and B2B customer stories (e.g. HubSpot, Monday, Figma).",
      sourceLabel: "Company website",
      sourceUrl: "https://ramp.com/customers",
    },
    {
      id: "clear-sales-org",
      label: "Clear sales organization",
      score: 86,
      present: "true",
      confidence: 0.9,
      evidence:
        "Leadership and careers surface VP/Head of Sales titles; enterprise page describes AE-led evaluation for larger deals.",
      sourceLabel: "Company website",
      sourceUrl: "https://ramp.com/enterprise",
    },
    {
      id: "outbound-motion",
      label: "Outbound / GTM motion",
      score: 72,
      present: "true",
      confidence: 0.8,
      evidence:
        "SDR and AE roles on careers plus sales-assisted enterprise motion; press notes scaling of outbound sales capacity.",
      sourceLabel: "Company careers page",
      sourceUrl: "https://ramp.com/careers",
    },
    {
      id: "tech-buyer-signals",
      label: "Tech/ops buyer signals",
      score: 79,
      present: "true",
      confidence: 0.85,
      evidence:
        "Integrations directory, security/trust (SOC 2), and public API docs for engineering and ops buyers.",
      sourceLabel: "Company website",
      sourceUrl: "https://ramp.com/integrations",
    },
  ],
  strategy: {
    summary:
      "Approach Ramp via sales leadership and RevOps on AE ramp and international expansion pain suggested by open roles and the Canada launch; propose a narrow pilot tied to outbound motion and post–Series D scale.",
    whyNow: [
      "Active sales team growth: multiple open AE/enterprise sales roles and recent sales leadership hires",
      "Series D capital aimed at sales and international expansion",
      "Canada market launch creates pressure for scalable outbound processes across regions",
    ],
    entryPoints: [
      "VP of Enterprise Sales / Head of Sales",
      "RevOps or sales enablement",
      "Hiring managers for SDR/AE pods",
    ],
    talkTracks: [
      {
        title: "Open on sales team scaling",
        script:
          "“Saw Ramp posting multiple AE and enterprise AE roles alongside new sales leadership. Teams in that phase often hit ramp time and pipeline consistency issues when expanding into markets like Canada — is that showing up in your pods?”",
        tiedAttributeIds: ["growing-sales-team", "new-market-expansion"],
      },
      {
        title: "Tie to funding and outbound motion",
        script:
          "“With growth capital earmarked for sales and international expansion, peers usually look for ways to shorten ramp cycles without adding research headcount at the same rate. Happy to compare notes on a single enterprise pod.”",
        tiedAttributeIds: ["recent-funding", "outbound-motion"],
      },
    ],
    risksAndObjections: [
      "Ramp already has deep integrations and API surfaces — validate that any pitch is not overlapping internal tooling priorities.",
      "Sales leadership may prefer building enablement in-house given the maturity of the sales org.",
    ],
    nextSteps: [
      "Map public VP Enterprise Sales / RevOps titles for outbound",
      "Personalize first touch with open AE roles and Canada launch",
      "Offer a short pilot scoped to one pod ramping enterprise AEs",
    ],
  },
  limitations: [
    "Sample report based on a real public-web analysis of ramp.com (cached for the demo walkthrough).",
    "Public-web estimate only — not investment, credit, or legal advice.",
  ],
});
