import {
  isMockN8n,
  N8N_TRIGGER_TIMEOUT_MS,
} from "@/lib/constants";
import type { Profile } from "@/lib/types";

export type N8nTriggerPayload = {
  jobId: string;
  domain: string;
  normalizedUrl: string;
  profileId: string;
  profile: Profile;
  callbackUrl: string;
};

export type N8nTriggerResult =
  | { ok: true; mock: boolean; executionId?: string }
  | { ok: false; error: string };

/**
 * Base URL for n8n → app callbacks.
 * Prefer APP_CALLBACK_URL / APP_PUBLIC_URL (Docker-reachable) over
 * NEXT_PUBLIC_APP_URL (browser origin), so n8n containers can reach the host.
 */
export function appCallbackBaseUrl() {
  return (
    process.env.APP_CALLBACK_URL?.replace(/\/$/, "") ||
    process.env.APP_PUBLIC_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

export function buildCallbackUrl(jobId: string) {
  return `${appCallbackBaseUrl()}/api/jobs/${jobId}/callback`;
}

/**
 * Fire n8n webhook (Respond Immediately). When MOCK_N8N=1, skip HTTP and
 * schedule a local mock completion.
 */
export async function triggerN8nWorkflow(
  payload: N8nTriggerPayload,
): Promise<N8nTriggerResult> {
  if (isMockN8n()) {
    return { ok: true, mock: true, executionId: `mock-${payload.jobId.slice(0, 8)}` };
  }

  const url = process.env.N8N_WEBHOOK_URL?.trim();
  const secret = process.env.GTM_WEBHOOK_SECRET?.trim();
  if (!url) {
    return { ok: false, error: "N8N_WEBHOOK_URL is not configured" };
  }
  if (!secret) {
    return { ok: false, error: "GTM_WEBHOOK_SECRET is not configured" };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gtm-Webhook-Secret": secret,
      },
      body: JSON.stringify({
        jobId: payload.jobId,
        domain: payload.domain,
        normalizedUrl: payload.normalizedUrl,
        profileId: payload.profileId,
        profile: payload.profile,
        callbackUrl: payload.callbackUrl,
        // Body secret for n8n Code-node check (header may not be forwarded into $json)
        gtmWebhookSecret: secret,
        attributes: payload.profile.attributes.map((a) => ({
          id: a.id,
          label: a.label,
          weight: a.weight,
          researchPrompt: a.researchPrompt.replaceAll(
            "{domain}",
            payload.domain,
          ),
          positiveSignals: a.positiveSignals,
          negativeSignals: a.negativeSignals,
        })),
      }),
      signal: AbortSignal.timeout(N8N_TRIGGER_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `n8n HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }

    return { ok: true, mock: false };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "n8n trigger failed";
    return { ok: false, error: message };
  }
}

/** Build mock findings + strategy for local demos without n8n. */
export function buildMockCallbackBody(profile: Profile, domain: string) {
  const findings = profile.attributes.map((attr, index) => {
    const present =
      index % 5 === 0 ? ("unknown" as const) : ("true" as const);
    return {
      attributeId: attr.id,
      present,
      confidence: present === "unknown" ? 0.15 : 0.75 + (index % 3) * 0.05,
      scoreHint: present === "unknown" ? 20 : 65 + (index % 4) * 5,
      evidence:
        present === "unknown"
          ? []
          : [
              {
                snippet: `Mock public signal for ${attr.label} at ${domain}.`,
                sourceUrl: `https://${domain}`,
              },
              {
                snippet: `Secondary note aligned with ${attr.positiveSignals[0] ?? attr.label}.`,
              },
            ],
      notes: present === "unknown" ? "No clear public evidence in mock mode." : undefined,
    };
  });

  return {
    status: "complete" as const,
    executionId: `mock-exec-${Date.now()}`,
    findings,
    strategy: {
      summary: `Mock strategy for ${domain} under profile “${profile.name}”. Replace MOCK_N8N=0 and point at n8n for live research.`,
      whyNow: [
        "Mock: expansion signals suggest a timely outreach window.",
        "Mock: public GTM pages indicate active buyer evaluation.",
      ],
      entryPoints: [
        "Ops / RevOps stakeholder",
        "Sales leadership if AE hiring is visible",
      ],
      talkTracks: [
        {
          title: "Efficiency for growing teams",
          script: `For teams like ${domain}, lead with a concrete workflow win tied to the strongest attribute scores.`,
          tiedAttributeIds: findings
            .filter((f) => f.present === "true")
            .slice(0, 2)
            .map((f) => f.attributeId),
        },
      ],
      discoveryQuestions: [
        "Who owns pipeline tooling decisions today?",
        "What changed in the last two quarters that made this a priority?",
      ],
      risksAndObjections: [
        "Limited public data may overstate fit — validate with discovery.",
      ],
      nextSteps: [
        "Confirm ICP attributes on a discovery call",
        "Share a one-page ROI brief",
        "Propose a short pilot",
      ],
    },
    meta: {
      perplexityModel: "mock",
      openRouterModel: "mock",
      durationMs: 1200,
      stage: "strategy",
    },
  };
}
