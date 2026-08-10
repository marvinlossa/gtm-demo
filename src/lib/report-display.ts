/** Client-side display model for the prospect report (sample + live jobs). */

export type BuyingSignalLevel = "High" | "Medium" | "Low";
export type PriorityLevel = "High" | "Medium" | "Low";
export type RecommendationVerdict = "Pursue" | "Monitor" | "Low priority";

export type DisplayAttribute = {
  id: string;
  label: string;
  /** Normalized criterion score 0–100 from scoring.v1. */
  score: number;
  /** Profile weight (0–1). Used to show weighted points in the UI. */
  weight?: number;
  present: string;
  confidence: number;
  evidence: string;
  sourceLabel?: string;
  sourceUrl?: string;
};

export type PotentialObjection = {
  text: string;
  howToAddress?: string;
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
  topReasons: string[];
  attributes: DisplayAttribute[];
  whyNowNarrative: string;
  whyNowSignals: Array<{ title: string; detail: string }>;
  whoToApproach: string;
  whoToApproachWhy: string;
  alternativeContact?: string;
  likelyChallenge: string;
  salesAngle: string;
  conversationStarter: string;
  potentialObjection?: PotentialObjection;
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

/** Map attribute ids / labels to short, human signal titles for Why now? */
const SIGNAL_TITLE_HINTS: Array<{ match: RegExp; title: string }> = [
  { match: /hir|sales.?team|ae\b|sdr/i, title: "Sales team growth" },
  { match: /fund|series|capital|raise/i, title: "Growth funding" },
  {
    match: /market|expand|international|canada|region|office|geo/i,
    title: "International expansion",
  },
  { match: /outbound|gtm|sdr motion/i, title: "Outbound motion" },
  { match: /b2b|enterprise|pricing/i, title: "B2B commercial model" },
  { match: /sales.?org|leadership|vp|cro/i, title: "Sales leadership" },
  { match: /tech|api|integrat|security/i, title: "Technical buyer surfaces" },
];

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

/** Convert 0–100 criterion score + weight → weighted points for display. */
export function weightedCriterionScore(
  score: number,
  weight = 0.1,
): { points: number; maxPoints: number } {
  const maxPoints = Math.max(1, Math.round(weight * 100));
  const points = Math.round((Math.min(100, Math.max(0, score)) / 100) * maxPoints);
  return { points, maxPoints };
}

export function prioritySupportingCopy(priority: PriorityLevel): string {
  if (priority === "High") return "Worth pursuing now";
  if (priority === "Medium") return "Worth a closer look";
  return "Lower priority for now";
}

export function humanSourceLabel(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("techcrunch")) return "TechCrunch";
    if (host.includes("cnbc")) return "CNBC";
    if (host.includes("bloomberg")) return "Bloomberg";
    if (host.includes("careers") || url.includes("/careers")) {
      return "Company careers page";
    }
    if (url.includes("blog") || url.includes("news") || url.includes("press")) {
      return "Company announcement";
    }
    if (host.includes("ramp.com") || host.endsWith(".com")) {
      if (url.includes("customers")) return "Company website";
      if (url.includes("enterprise")) return "Company website";
      if (url.includes("integrations")) return "Company website";
      if (host.includes("docs.")) return "API documentation";
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

function titleFromSignalText(detail: string, fallbackIndex: number): string {
  for (const hint of SIGNAL_TITLE_HINTS) {
    if (hint.match.test(detail)) return hint.title;
  }
  // First clause / short head of the sentence as title when possible
  const head = detail.split(/[:.—–-]/)[0]?.trim() ?? "";
  if (head.length >= 8 && head.length <= 48) return head;
  return `Growth signal ${fallbackIndex + 1}`;
}

function titleFromAttribute(attr: DisplayAttribute): string {
  for (const hint of SIGNAL_TITLE_HINTS) {
    if (hint.match.test(attr.id) || hint.match.test(attr.label)) {
      return hint.title;
    }
  }
  return attr.label;
}

/** Short bullets for scan-friendly “Top reasons”. */
export function deriveTopReasons(attributes: DisplayAttribute[]): string[] {
  return attributes
    .filter((a) => a.present === "true" && a.score >= 65)
    .sort((a, b) => {
      const aw = (a.weight ?? 0.1) * a.score;
      const bw = (b.weight ?? 0.1) * b.score;
      return bw - aw;
    })
    .slice(0, 5)
    .map((a) => {
      // Prefer concise business phrasing over raw labels when we can map them
      const mapped: Record<string, string> = {
        "growing-sales-team": "Growing enterprise sales team",
        "new-market-expansion": "Recent international expansion",
        "recent-funding": "Recent growth funding",
        "b2b-offering": "Strong B2B commercial model",
        "clear-sales-org": "Clear sales leadership structure",
        "outbound-motion": "Active outbound / sales-assisted motion",
        "tech-buyer-signals": "Technical and ops buyer surfaces",
      };
      return mapped[a.id] ?? a.label;
    });
}

function stripQuotes(text: string): string {
  return text
    .replace(/^[“"']+/, "")
    .replace(/[”"']+$/, "")
    .replace(/^[“"]|[”"]$/g, "")
    .trim();
}

function looksLikeDialogue(text: string): boolean {
  const t = text.trim();
  return (
    t.includes("“") ||
    t.includes('"') ||
    t.includes("?”") ||
    /\?\s*$/.test(t) ||
    /^(saw |i noticed |noticed |hey |hi )/i.test(t)
  );
}

function looksLikeObjection(text: string): boolean {
  return /already|overlap|in-house|internal|prefer|mature|compet|object|risk|may not|unlikely/i.test(
    text,
  );
}

/**
 * Business challenge from growth signals — not competitive objections.
 */
export function deriveLikelyChallenge(
  domain: string,
  attributes: DisplayAttribute[],
  risks: string[],
): string {
  const growth = attributes.filter(
    (a) =>
      a.present === "true" &&
      (TIMING_ATTRIBUTE_IDS.has(a.id) ||
        /hir|fund|expand|growth|market|sales/i.test(a.label)),
  );
  if (growth.length >= 2) {
    return `Based on the public signals, ${domain} may be facing increasing pressure to keep prospecting and pipeline processes consistent as the sales team and market footprint expand.`;
  }
  if (growth.length === 1) {
    return `Based on the public signals, ${domain} may be under pressure to scale commercial processes as ${growth[0].label.toLowerCase()} continues.`;
  }
  // Avoid using pure objections as the challenge
  const nonObjection = risks.find((r) => !looksLikeObjection(r));
  if (nonObjection) return nonObjection;
  return `Based on public signals, ${domain} may have GTM process gaps worth validating on a discovery call — treat this as a working hypothesis.`;
}

export function derivePotentialObjection(
  risks: string[],
): PotentialObjection | undefined {
  const objection = risks.find((r) => looksLikeObjection(r));
  if (!objection) return undefined;

  let howToAddress =
    "Focus on a specific workflow gap rather than a generic automation pitch.";
  if (/integrat|api|tooling|internal/i.test(objection)) {
    howToAddress =
      "Focus on a specific workflow gap rather than general AI automation — make the pitch more precise than tools they may already run.";
  } else if (/in-house|prefer|build/i.test(objection)) {
    howToAddress =
      "Position a narrow pilot that complements existing enablement instead of replacing it.";
  }

  return { text: objection, howToAddress };
}

/** Strategy positioning — never dialogue in quotes. */
export function deriveSalesAngle(
  summary: string | undefined,
  talkScripts: string[],
  domain: string,
): string {
  const candidates = [summary, ...talkScripts].filter(Boolean) as string[];
  for (const c of candidates) {
    const cleaned = stripQuotes(c);
    if (!looksLikeDialogue(cleaned) && cleaned.length > 40) {
      // Prefer positioning language
      if (
        /position|approach|propose|pilot|scale|pipeline|ramp|outbound/i.test(
          cleaned,
        )
      ) {
        return cleaned;
      }
    }
  }
  // Synthesize from summary if it was dialogue-heavy
  if (summary && !looksLikeDialogue(stripQuotes(summary))) {
    return stripQuotes(summary);
  }
  return `Position automated prospect research and qualification as a way to maintain pipeline consistency while ${domain} expands sales capacity and market footprint.`;
}

/** Short conversational open — not the same as sales angle. */
export function deriveConversationStarter(
  talkScripts: string[],
  attributes: DisplayAttribute[],
  domain: string,
): string {
  const dialogue = talkScripts
    .map(stripQuotes)
    .find((t) => looksLikeDialogue(t) || t.includes("?"));
  if (dialogue) {
    // Keep to ~2 sentences
    const sentences = dialogue.split(/(?<=[.?!])\s+/).filter(Boolean);
    return sentences.slice(0, 2).join(" ");
  }

  const hiring = attributes.find(
    (a) => a.present === "true" && /hir|sales.?team|ae/i.test(a.id + a.label),
  );
  const expand = attributes.find(
    (a) =>
      a.present === "true" && /market|expand|fund/i.test(a.id + a.label),
  );
  if (hiring && expand) {
    return `Saw ${domain} hiring commercial roles while expanding footprint. Has keeping prospect research and pipeline quality consistent across teams become harder as you scale?`;
  }
  if (hiring) {
    return `Noticed open commercial roles at ${domain}. Has AE ramp or pipeline consistency become harder as the team grows?`;
  }
  return `Curious whether prospect research and qualification stay consistent as ${domain} scales GTM — worth a quick compare?`;
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
  /** Optional overrides for curated samples. */
  overrides?: Partial<
    Pick<
      DisplayResult,
      | "likelyChallenge"
      | "salesAngle"
      | "conversationStarter"
      | "potentialObjection"
      | "topReasons"
      | "whoToApproachWhy"
      | "whyNowSignals"
      | "whyNowNarrative"
    >
  >;
}): DisplayResult {
  const whyNow = input.strategy.whyNow ?? [];
  const risks = input.strategy.risksAndObjections ?? [];
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

  let whyNowSignals: Array<{ title: string; detail: string }> = whyNow
    .slice(0, 4)
    .map((detail, i) => ({
      title: titleFromSignalText(detail, i),
      detail,
    }));

  if (whyNowSignals.length < 2) {
    for (const attr of input.attributes) {
      if (attr.present !== "true" || whyNowSignals.length >= 4) continue;
      if (
        TIMING_ATTRIBUTE_IDS.has(attr.id) ||
        /hir|fund|expand|growth|market/i.test(attr.label)
      ) {
        whyNowSignals.push({
          title: titleFromAttribute(attr),
          detail: attr.evidence,
        });
      }
    }
  }

  // Dedupe titles
  const seenTitles = new Set<string>();
  whyNowSignals = whyNowSignals.filter((s) => {
    if (seenTitles.has(s.title)) return false;
    seenTitles.add(s.title);
    return true;
  });

  const whyNowNarrative =
    whyNow.length >= 2
      ? whyNow.slice(0, 2).join(" ")
      : whyNow[0] ||
        "Public timing signals are limited — validate urgency on a discovery conversation.";

  const likelyChallenge = deriveLikelyChallenge(
    input.domain,
    input.attributes,
    risks,
  );
  const potentialObjection = derivePotentialObjection(risks);
  const salesAngle = deriveSalesAngle(
    input.strategy.summary,
    talkScripts,
    input.domain,
  );
  const conversationStarter = deriveConversationStarter(
    talkScripts,
    input.attributes,
    input.domain,
  );
  const topReasons = deriveTopReasons(input.attributes);

  const base: DisplayResult = {
    domain: input.domain,
    profileLabel: input.profileLabel,
    overallScore: input.overallScore,
    fitBand: input.fitBand,
    buyingSignal,
    priority,
    recommendation: verdict,
    recommendationBlurb: blurb,
    topReasons,
    attributes: input.attributes,
    whyNowNarrative,
    whyNowSignals: whyNowSignals.slice(0, 4),
    whoToApproach,
    whoToApproachWhy:
      "Likely owns the commercial growth and the processes affected by the current expansion signals.",
    alternativeContact,
    likelyChallenge,
    salesAngle,
    conversationStarter,
    potentialObjection,
    limitations: input.limitations,
  };

  return { ...base, ...input.overrides };
}

/**
 * Sample report for the walkthrough — based on a real live analysis of ramp.com
 * (GTM Scale-Up / sales-expansion), with curated GTM-facing copy.
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
      weight: 0.2,
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
      weight: 0.18,
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
      weight: 0.15,
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
      weight: 0.15,
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
      weight: 0.12,
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
      weight: 0.1,
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
      weight: 0.1,
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
      "Position automated prospect research and qualification as a way to maintain pipeline consistency while the sales organization expands across teams and markets — approach sales leadership and RevOps with a narrow pilot, not a generic AI pitch.",
    whyNow: [
      "Multiple open AE and enterprise sales positions alongside recent sales leadership hires.",
      "Recent funding is explicitly supporting sales and international expansion.",
      "Expansion into Canada creates additional pressure to scale commercial processes across regions.",
    ],
    entryPoints: [
      "VP of Enterprise Sales / Head of Sales",
      "RevOps or sales enablement",
    ],
    talkTracks: [
      {
        title: "Conversation open",
        script:
          "Saw you're hiring multiple enterprise AEs while expanding into Canada. Has keeping prospect research and pipeline quality consistent across teams become more difficult as you scale?",
      },
    ],
    risksAndObjections: [
      "Ramp already has extensive internal automation capabilities and API surfaces, so a generic automation pitch is unlikely to resonate.",
    ],
  },
  limitations: [
    "Sample report generated from a cached public-web analysis of ramp.com.",
  ],
  overrides: {
    whoToApproachWhy:
      "Likely owns enterprise sales growth and the processes affected by the current expansion signals.",
    likelyChallenge:
      "Based on the public signals, Ramp may be facing increasing pressure to keep prospecting and pipeline processes consistent as the sales team and market footprint expand.",
    salesAngle:
      "Position automated prospect research and qualification as a way to maintain pipeline consistency while the sales organization expands across teams and markets.",
    conversationStarter:
      "Saw you're hiring multiple enterprise AEs while expanding into Canada. Has keeping prospect research and pipeline quality consistent across teams become more difficult as you scale?",
    potentialObjection: {
      text: "Ramp already has extensive internal automation capabilities, so a generic automation pitch is unlikely to resonate.",
      howToAddress:
        "Focus on a specific workflow gap rather than general AI automation.",
    },
    topReasons: [
      "Growing enterprise sales team",
      "Recent international expansion",
      "Strong B2B commercial model",
      "Clear sales leadership structure",
      "Recent growth funding",
    ],
    whyNowSignals: [
      {
        title: "Sales team growth",
        detail:
          "Multiple open AE and enterprise sales positions alongside recent sales leadership hires.",
      },
      {
        title: "Growth funding",
        detail:
          "Recent funding is explicitly supporting sales and international expansion.",
      },
      {
        title: "International expansion",
        detail:
          "Expansion into Canada creates additional pressure to scale commercial processes across regions.",
      },
    ],
    whyNowNarrative:
      "Ramp is hiring commercial roles, investing growth capital in sales expansion, and entering new markets — a combination that usually strains consistent prospecting and pipeline processes.",
  },
});
