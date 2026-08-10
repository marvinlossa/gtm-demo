import {
  isMockN8n,
  N8N_TRIGGER_TIMEOUT_MS,
} from "@/lib/constants";
import {
  ensureN8nWorkflow,
  isWebhookNotRegisteredError,
} from "@/lib/n8n-ensure";
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

function buildTriggerBody(payload: N8nTriggerPayload, secret: string) {
  return {
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
      researchPrompt: a.researchPrompt.replaceAll("{domain}", payload.domain),
      positiveSignals: a.positiveSignals,
      negativeSignals: a.negativeSignals,
    })),
  };
}

async function postWebhook(
  url: string,
  secret: string,
  payload: N8nTriggerPayload,
): Promise<N8nTriggerResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gtm-Webhook-Secret": secret,
      },
      body: JSON.stringify(buildTriggerBody(payload, secret)),
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

/**
 * Fire n8n webhook (Respond Immediately). When MOCK_N8N=1, skip HTTP and
 * schedule a local mock completion.
 * On webhook-not-registered (common after n8n restart), re-import/activate
 * the workflow from the repo export and retry once.
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

  const first = await postWebhook(url, secret, payload);
  if (first.ok) return first;

  if (!isWebhookNotRegisteredError(first.error)) {
    return first;
  }

  console.warn(
    JSON.stringify({
      event: "n8n_webhook_missing_self_heal",
      jobId: payload.jobId,
      error: first.error,
    }),
  );

  const ensured = await ensureN8nWorkflow();
  console.info(
    JSON.stringify({
      event: "n8n_ensure_workflow",
      jobId: payload.jobId,
      ok: ensured.ok,
      ...(ensured.ok
        ? { action: ensured.action, workflowId: ensured.workflowId }
        : { error: ensured.error }),
    }),
  );

  if (!ensured.ok) {
    return {
      ok: false,
      error: `${first.error} | self-heal failed: ${ensured.error}`,
    };
  }

  // Brief pause so n8n registers the production webhook
  await new Promise((r) => setTimeout(r, 1500));
  return postWebhook(url, secret, payload);
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
      summary: `Mock outbound plan for selling into prospect ${domain} under ICP “${profile.name}”. The reader is the seller — not an employee of ${domain}.`,
      whyNow: [
        "Mock: public signals suggest a timely window to approach this prospect.",
        "Mock: GTM-facing pages imply active evaluation of tools/process.",
      ],
      entryPoints: [
        "Prospect RevOps / sales ops if hiring or process language is visible",
        "Prospect sales leadership (VP Sales / CRO) when AE/SDR growth appears",
      ],
      talkTracks: [
        {
          title: "Seller script — capacity after growth",
          script: `When speaking with stakeholders at ${domain}, open with a hypothesis about ramp or handoff pain, then ask for confirmation — do not speak as if you run their company.`,
          tiedAttributeIds: findings
            .filter((f) => f.present === "true")
            .slice(0, 2)
            .map((f) => f.attributeId),
        },
      ],
      discoveryQuestions: [
        "At the prospect: who owns pipeline tooling and sales process decisions?",
        "What changed in their GTM in the last two quarters that might create urgency?",
      ],
      risksAndObjections: [
        "Public data may overstate fit — validate on a discovery call with the prospect.",
      ],
      nextSteps: [
        "Identify 2–3 prospect stakeholders from public pages",
        "Draft outbound messaging for the seller (not internal memo to the prospect)",
        "Propose a narrow pilot the prospect can accept",
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
