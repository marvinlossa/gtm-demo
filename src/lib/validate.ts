import { z } from "zod";

const evidenceItemSchema = z.object({
  snippet: z.string().min(1).max(2000),
  sourceUrl: z.string().optional(),
  publishedAt: z.string().nullable().optional(),
});

const attributeFindingSchema = z.object({
  attributeId: z.string().min(1),
  present: z.union([
    z.enum(["true", "false", "unknown"]),
    z.boolean(),
    z.string(),
  ]),
  confidence: z.number().optional(),
  scoreHint: z.number().optional(),
  evidence: z.array(evidenceItemSchema).max(10).optional().default([]),
  notes: z.string().max(1000).optional(),
});

const salesStrategySchema = z.object({
  summary: z.string().min(1),
  whyNow: z.array(z.string()).default([]),
  entryPoints: z.array(z.string()).default([]),
  talkTracks: z
    .array(
      z.object({
        title: z.string(),
        script: z.string(),
        tiedAttributeIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  discoveryQuestions: z.array(z.string()).default([]),
  risksAndObjections: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});

const completeCallbackSchema = z.object({
  status: z.literal("complete"),
  executionId: z.string().optional(),
  findings: z.array(attributeFindingSchema).min(1),
  strategy: salesStrategySchema,
  meta: z
    .object({
      perplexityModel: z.string().optional(),
      openRouterModel: z.string().optional(),
      durationMs: z.number().optional(),
      stage: z.string().optional(),
    })
    .optional(),
});

const failedCallbackSchema = z.object({
  status: z.literal("failed"),
  executionId: z.string().optional(),
  error: z.string().min(1),
});

const progressCallbackSchema = z.object({
  status: z.literal("running"),
  stage: z.enum(["research", "strategy"]),
  executionId: z.string().optional(),
});

export const callbackBodySchema = z.discriminatedUnion("status", [
  completeCallbackSchema,
  failedCallbackSchema,
  progressCallbackSchema,
]);

export type CallbackBody = z.infer<typeof callbackBodySchema>;

export function parseCallbackBody(raw: unknown):
  | { ok: true; data: CallbackBody }
  | { ok: false; error: string } {
  const parsed = callbackBodySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; ") || "invalid",
    };
  }
  return { ok: true, data: parsed.data };
}
