import { Pill } from "@/components/UiPrimitives";

type WorkflowStageKey = "idle" | "research" | "strategy" | "scoring" | "done" | "failed";

const stageToNode: Record<
  Exclude<WorkflowStageKey, "idle" | "failed">,
  string
> = {
  research: "node-research",
  strategy: "node-strategy",
  scoring: "node-score",
  done: "node-done",
};

/**
 * Pre-rendered workflow visualization (design: SVG only, no live n8n iframe).
 * Stage highlighting is driven by job stage / heuristic theater.
 */
export function WorkflowPanel({
  stage = "idle",
}: {
  stage?: WorkflowStageKey;
}) {
  const activeId =
    stage === "idle" || stage === "failed"
      ? null
      : stageToNode[stage];

  function nodeClass(id: string) {
    const base =
      "rounded-2xl border px-3 py-2.5 text-sm font-medium transition";
    if (stage === "failed") {
      return `${base} border-red-300/40 bg-red-950/30 text-red-100`;
    }
    if (activeId === id || (stage === "done" && id === "node-done")) {
      return `${base} border-amber-300/50 bg-amber-300/15 text-amber-50 shadow-[0_0_0_1px_rgba(252,211,77,0.25)]`;
    }
    if (stage === "done") {
      return `${base} border-cyan-300/30 bg-cyan-300/10 text-cyan-50`;
    }
    return `${base} border-white/10 bg-white/5 text-stone-300`;
  }

  return (
    <div className="rounded-[1.75rem] border border-white/15 bg-black/25 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone-300">
          n8n workflow
        </p>
        <Pill tone={stage === "failed" ? "amber" : stage === "done" ? "cyan" : "stone"}>
          {stage === "idle" ? "Idle" : stage}
        </Pill>
      </div>
      <div className="grid gap-2" aria-label="GTM fit analysis workflow">
        <div id="node-trigger" className={nodeClass("node-trigger")}>
          1 · Webhook trigger
        </div>
        <div className="pl-4 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
          ↓
        </div>
        <div id="node-research" className={nodeClass("node-research")}>
          2 · Perplexity research
        </div>
        <div className="pl-4 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
          ↓
        </div>
        <div id="node-strategy" className={nodeClass("node-strategy")}>
          3 · OpenRouter strategy
        </div>
        <div className="pl-4 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
          ↓
        </div>
        <div id="node-score" className={nodeClass("node-score")}>
          4 · App scoring.v1
        </div>
        <div className="pl-4 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
          ↓
        </div>
        <div id="node-done" className={nodeClass("node-done")}>
          5 · Callback → results
        </div>
      </div>
      <p className="mt-3 px-1 text-xs leading-5 text-stone-500">
        Live orchestration runs in n8n. This panel is the public demo view of
        the workflow graph.
      </p>
    </div>
  );
}
