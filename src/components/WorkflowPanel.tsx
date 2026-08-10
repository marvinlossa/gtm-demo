import { Pill } from "@/components/UiPrimitives";

type WorkflowStageKey =
  | "idle"
  | "research"
  | "strategy"
  | "scoring"
  | "done"
  | "failed";

const stageToNode: Record<
  Exclude<WorkflowStageKey, "idle" | "failed">,
  string
> = {
  research: "node-research",
  strategy: "node-strategy",
  scoring: "node-score",
  done: "node-done",
};

const stagePillLabel: Record<WorkflowStageKey, string> = {
  idle: "Idle",
  research: "Research",
  strategy: "Strategy",
  scoring: "Scoring",
  done: "Done",
  failed: "Failed",
};

type FlowNode = {
  id: string;
  title: string;
  tech?: string;
};

const FLOW_NODES: FlowNode[] = [
  { id: "node-trigger", title: "Receive prospect" },
  {
    id: "node-research",
    title: "Research company",
    tech: "Perplexity",
  },
  {
    id: "node-strategy",
    title: "Evaluate strategy",
    tech: "OpenRouter",
  },
  { id: "node-score", title: "Calculate fit score" },
  { id: "node-done", title: "Return prospect report" },
];

/**
 * Pre-rendered workflow visualization (design: SVG-free list, no live n8n iframe).
 * Stage highlighting is driven by job stage / progress theater.
 */
export function WorkflowPanel({
  stage = "idle",
}: {
  stage?: WorkflowStageKey;
}) {
  const activeId =
    stage === "idle" || stage === "failed" ? null : stageToNode[stage];

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
        <div className="flex items-center gap-2">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone-300">
            Automation
          </p>
          <Pill tone="stone">n8n</Pill>
        </div>
        <Pill
          tone={
            stage === "failed" ? "amber" : stage === "done" ? "cyan" : "stone"
          }
        >
          {stagePillLabel[stage]}
        </Pill>
      </div>
      <div className="grid gap-2" aria-label="Prospect analysis workflow">
        {FLOW_NODES.map((node, index) => (
          <div key={node.id}>
            {index > 0 ? (
              <div className="pl-4 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
                ↓
              </div>
            ) : null}
            <div id={node.id} className={nodeClass(node.id)}>
              <div className="flex items-center justify-between gap-2">
                <span>
                  {index + 1} · {node.title}
                </span>
                {node.tech ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-400">
                    {node.tech}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 px-1 text-xs leading-5 text-stone-500">
        A simplified view of the automation powering this analysis.
      </p>
    </div>
  );
}
