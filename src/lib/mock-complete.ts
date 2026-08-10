import { buildMockCallbackBody } from "@/lib/n8n";
import { processCallback } from "@/lib/process-callback";
import type { Profile } from "@/lib/types";

/**
 * Schedule mock n8n completion shortly after trigger (local/demo only).
 * Uses processCallback so scoring + lifecycle match real callbacks.
 */
export function scheduleMockCompletion(jobId: string, profile: Profile, domain: string) {
  const delayMs = Number(process.env.MOCK_N8N_DELAY_MS) || 1500;
  setTimeout(() => {
    try {
      // Progress tick
      processCallback(jobId, {
        status: "running",
        stage: "strategy",
        executionId: `mock-${jobId.slice(0, 8)}`,
      });
      const body = buildMockCallbackBody(profile, domain);
      const result = processCallback(jobId, body);
      if (!result.ok) {
        console.error("[gtm-demo] mock complete failed", result.error);
      }
    } catch (error) {
      console.error("[gtm-demo] mock complete error", error);
    }
  }, delayMs).unref?.();
}
