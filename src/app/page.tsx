"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import {
  Pill,
  SelectEdit,
  TechnologyMarks,
  TextEdit,
} from "@/components/UiPrimitives";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import {
  buildDisplayResult,
  confidenceLabel,
  evidenceStrength,
  humanSourceLabel,
  SAMPLE_RESULT,
  type DisplayResult,
  type JobStrategyPayload,
} from "@/lib/report-display";
import {
  type AppStage,
  appStages,
  panelInnerClass,
  panelOuterClass,
  primaryButtonClass,
  secondaryButtonClass,
  SEED_PROFILE_OPTIONS,
  slideBackground,
  solidCtaClass,
  stageEyebrowClass,
  stageSectionClass,
} from "@/lib/ui";

declare global {
  interface Window {
    turnstile?: { reset: (widgetId?: string) => void };
    onTurnstileSuccess?: (token: string) => void;
    onTurnstileExpired?: () => void;
  }
}

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type WorkflowUiStage =
  | "idle"
  | "research"
  | "strategy"
  | "scoring"
  | "done"
  | "failed";

/** Monotonic rank — UI stage must never move backwards (stops research↔strategy flicker). */
const WORKFLOW_STAGE_RANK: Record<WorkflowUiStage, number> = {
  idle: 0,
  research: 1,
  strategy: 2,
  scoring: 3,
  done: 4,
  failed: 5,
};

function advanceWorkflowStage(
  current: WorkflowUiStage,
  next: WorkflowUiStage,
): WorkflowUiStage {
  if (next === "failed") return "failed";
  if (current === "failed") return current;
  return WORKFLOW_STAGE_RANK[next] >= WORKFLOW_STAGE_RANK[current]
    ? next
    : current;
}

type RateLimitModal = {
  title: string;
  message: string;
  resetAt?: string;
  limit?: number;
};

type JobPollResponse = {
  id: string;
  domain: string;
  profileId: string;
  status: "pending" | "running" | "complete" | "failed";
  stage: string | null;
  error: string | null;
  result: {
    overallScore: number;
    fitBand: string;
    attributes: Array<{
      attributeId: string;
      label: string;
      attributeScore: number;
      present: string;
      confidence: number;
      evidence: Array<{ snippet: string; sourceUrl?: string }>;
    }>;
    strategy: JobStrategyPayload;
    limitations?: string[];
  } | null;
};

function mapJobToDisplay(
  job: JobPollResponse,
  profileLabel: string,
): DisplayResult | null {
  if (!job.result) return null;
  const attributes = job.result.attributes.map((a) => {
    const first = a.evidence?.[0];
    return {
      id: a.attributeId,
      label: a.label,
      score: a.attributeScore,
      present: a.present,
      confidence: a.confidence,
      evidence: first?.snippet ?? "No evidence snippet.",
      sourceUrl: first?.sourceUrl,
      sourceLabel: humanSourceLabel(first?.sourceUrl),
    };
  });

  return buildDisplayResult({
    domain: job.domain,
    profileLabel,
    overallScore: job.result.overallScore,
    fitBand: job.result.fitBand,
    attributes,
    strategy: job.result.strategy ?? {},
    limitations: job.result.limitations,
  });
}

type PollHandlers = {
  onStage: (stage: WorkflowUiStage, label: string, percent: number) => void;
  onComplete: (result: DisplayResult) => void;
  onFailed: (message: string) => void;
  onTimeout: () => void;
};

/** Module-scope so lint does not treat Date.now as render impurity. */
async function pollJobUntilDone(
  id: string,
  pollAfterMs: number,
  profileLabel: string,
  signal: AbortSignal,
  handlers: PollHandlers,
) {
  const started = Date.now();
  const maxWaitMs = 270_000;
  while (!signal.aborted) {
    if (Date.now() - started > maxWaitMs) {
      handlers.onTimeout();
      return;
    }
    await new Promise((r) => setTimeout(r, pollAfterMs));
    if (signal.aborted) return;

    const response = await fetch(`/api/jobs/${id}`, { signal });
    if (response.status === 429) continue;
    if (!response.ok) {
      handlers.onFailed("Unable to poll job status.");
      return;
    }
    const job = (await response.json()) as JobPollResponse;

    if (job.stage === "strategy") {
      handlers.onStage("strategy", "Building the sales strategy", 70);
    } else if (job.stage === "research") {
      handlers.onStage("research", "Researching the company", 40);
    } else if (job.stage === "scoring" || job.stage === "done") {
      handlers.onStage("scoring", "Evaluating prospect fit", 96);
    }

    if (job.status === "complete" && job.result) {
      const display = mapJobToDisplay(job, profileLabel);
      if (display) handlers.onComplete(display);
      else handlers.onFailed("Result payload incomplete.");
      return;
    }

    if (job.status === "failed") {
      handlers.onFailed(
        job.error === "JOB_TIMEOUT"
          ? "Analysis timed out. Try again with another domain."
          : `Analysis failed${job.error ? ` (${job.error})` : ""}.`,
      );
      return;
    }
  }
}

function levelTone(level: string): "cyan" | "amber" | "stone" {
  if (level === "High" || level === "Pursue" || level === "Strong fit") {
    return "cyan";
  }
  if (
    level === "Medium" ||
    level === "Monitor" ||
    level === "Moderate fit"
  ) {
    return "amber";
  }
  return "stone";
}

export default function Home() {
  const [activeStage, setActiveStage] = useState<AppStage>("landing");
  const [domain, setDomain] = useState("");
  const [profileId, setProfileId] = useState<string>(
    SEED_PROFILE_OPTIONS[0].id,
  );
  const [profileOptions, setProfileOptions] = useState<
    Array<{ value: string; label: string; blurb: string }>
  >(
    SEED_PROFILE_OPTIONS.map((p) => ({
      value: p.id,
      label: p.label,
      blurb: p.blurb,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Client-only sample walkthrough (no n8n / no job). */
  const [isSimulatingSample, setIsSimulatingSample] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [liveResult, setLiveResult] = useState<DisplayResult | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [rateLimitModal, setRateLimitModal] = useState<RateLimitModal | null>(
    null,
  );
  const [workflowUiStage, setWorkflowUiStage] =
    useState<WorkflowUiStage>("idle");
  const [analysisSeconds, setAnalysisSeconds] = useState(0);
  const [analysisPercent, setAnalysisPercent] = useState(0);
  const [analysisLabel, setAnalysisLabel] = useState("Waiting for a company");
  const [analysisDetail, setAnalysisDetail] = useState(
    "Enter a company above to begin.",
  );
  const [showScoreHow, setShowScoreHow] = useState(false);

  const landingRef = useRef<HTMLElement>(null);
  const enterRef = useRef<HTMLElement>(null);
  const analysisRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const sampleSimAbortRef = useRef<AbortController | null>(null);
  /** Highest stage seen from server polls — heuristic must not override this. */
  const serverStageRef = useRef<WorkflowUiStage>("idle");

  const progressActive = isSubmitting || isSimulatingSample;

  function scrollToStage(stage: AppStage, options?: { force?: boolean }) {
    // Keep the left rail in sync immediately (IntersectionObserver can lag under
    // scroll-snap + nested main scroller).
    setActiveStage(stage);

    const el = ({
      landing: landingRef,
      enter: enterRef,
      analysis: analysisRef,
      results: resultsRef,
    })[stage].current;
    if (!el) return;

    const scroller =
      el.closest<HTMLElement>("[data-app-scroll]") ??
      el.closest("main") ??
      null;

    const run = () => {
      if (scroller) {
        const top =
          el.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        scroller.scrollTo({ top, behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    run();
    if (options?.force) {
      window.setTimeout(run, 80);
      window.setTimeout(run, 280);
    }
  }

  function scrollToResultsAfterComplete() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToStage("results", { force: true });
      });
    });
  }

  useEffect(() => {
    window.onTurnstileSuccess = setTurnstileToken;
    window.onTurnstileExpired = () => setTurnstileToken("");
    return () => {
      delete window.onTurnstileSuccess;
      delete window.onTurnstileExpired;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/profiles");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          profiles?: Array<{
            id: string;
            name: string;
            description: string;
          }>;
        };
        if (cancelled || !payload.profiles?.length) return;
        setProfileOptions(
          payload.profiles.map((p) => ({
            value: p.id,
            label: p.name,
            blurb: p.description,
          })),
        );
        setProfileId((current) =>
          payload.profiles!.some((p) => p.id === current)
            ? current
            : payload.profiles![0].id,
        );
      } catch {
        /* keep static fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sectionRefs = [landingRef, enterRef, analysisRef, resultsRef];
    const stageRank: Record<AppStage, number> = {
      landing: 0,
      enter: 1,
      analysis: 2,
      results: 3,
    };
    // Scroll happens on `main`, not the window — root must be the scroller.
    const root =
      document.querySelector<HTMLElement>("[data-app-scroll]") ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio > 0)
          .sort((a, b) => {
            if (b.intersectionRatio !== a.intersectionRatio) {
              return b.intersectionRatio - a.intersectionRatio;
            }
            const aStage = a.target.getAttribute("data-stage") as AppStage | null;
            const bStage = b.target.getAttribute("data-stage") as AppStage | null;
            return (stageRank[bStage ?? "landing"] ?? 0) - (stageRank[aStage ?? "landing"] ?? 0);
          })[0];
        const stage = visible?.target.getAttribute(
          "data-stage",
        ) as AppStage | null;
        if (stage) setActiveStage(stage);
      },
      {
        root,
        // Lower thresholds so tall result sections still register when snapped in view.
        threshold: [0.08, 0.15, 0.25, 0.4, 0.55, 0.75],
        rootMargin: "0px 0px -12% 0px",
      },
    );
    for (const ref of sectionRefs) {
      if (ref.current) observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
      sampleSimAbortRef.current?.abort();
    };
  }, []);

  /** Elapsed seconds + live-run progress theater (not used for sample sim). */
  useEffect(() => {
    if (!progressActive) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setAnalysisSeconds(Math.floor(elapsed / 1000));

      // Sample walkthrough owns percent/stages itself.
      if (isSimulatingSample) return;

      if (elapsed < 45_000) {
        setAnalysisPercent((p) =>
          Math.max(p, Math.min(55, 8 + (elapsed / 45_000) * 47)),
        );
      } else if (elapsed < 100_000) {
        setAnalysisPercent((p) =>
          Math.max(p, Math.min(92, 55 + ((elapsed - 45_000) / 55_000) * 37)),
        );
      } else {
        setAnalysisPercent((p) => Math.max(p, 94));
      }

      const server = serverStageRef.current;
      if (
        server === "done" ||
        server === "failed" ||
        server === "scoring" ||
        server === "strategy"
      ) {
        if (server === "strategy" && elapsed >= 100_000) {
          setAnalysisLabel((label) =>
            label.startsWith("Evaluating") || label.startsWith("Analysis")
              ? label
              : "Building the sales strategy",
          );
          setAnalysisDetail(
            "Identifying the best contact role and outreach angle.",
          );
        }
        return;
      }

      if (elapsed < 30_000) {
        setWorkflowUiStage((s) => advanceWorkflowStage(s, "research"));
        setAnalysisLabel("Researching the company");
        setAnalysisDetail(
          "Looking for relevant business, growth and GTM signals.",
        );
      } else if (elapsed < 55_000) {
        setWorkflowUiStage((s) => advanceWorkflowStage(s, "research"));
        setAnalysisLabel("Checking buying signals");
        setAnalysisDetail(
          "Looking for reasons why outreach may be relevant now.",
        );
      } else {
        setWorkflowUiStage((s) => advanceWorkflowStage(s, "strategy"));
        setAnalysisLabel("Building the sales strategy");
        setAnalysisDetail(
          "Identifying the best contact role and outreach angle.",
        );
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [progressActive, isSimulatingSample]);

  function selectedProfileLabel() {
    return (
      profileOptions.find((p) => p.value === profileId)?.label ?? profileId
    );
  }

  function selectedProfileBlurb() {
    return (
      profileOptions.find((p) => p.value === profileId)?.blurb ??
      SEED_PROFILE_OPTIONS.find((p) => p.id === profileId)?.blurb ??
      ""
    );
  }

  function resetAnalysisUi() {
    setIsSubmitting(false);
    setWorkflowUiStage("idle");
    serverStageRef.current = "idle";
    setAnalysisPercent(0);
    setAnalysisLabel("Waiting for a company");
    setAnalysisDetail("Enter a company above to begin.");
    window.turnstile?.reset();
    setTurnstileToken("");
  }

  function applyStage(stage: WorkflowUiStage, label: string, percent: number) {
    const prev = serverStageRef.current;
    const next = advanceWorkflowStage(prev, stage);
    serverStageRef.current = next;
    if (
      WORKFLOW_STAGE_RANK[next] > WORKFLOW_STAGE_RANK[prev] ||
      prev === "idle"
    ) {
      setWorkflowUiStage(next);
      setAnalysisLabel(label);
      if (stage === "research") {
        setAnalysisDetail(
          "Looking for relevant business, growth and GTM signals.",
        );
      } else if (stage === "strategy") {
        setAnalysisDetail(
          "Identifying the best contact role and outreach angle.",
        );
      } else if (stage === "scoring") {
        setAnalysisDetail(
          "Comparing the evidence against the selected ICP.",
        );
      }
    } else {
      setWorkflowUiStage((s) => advanceWorkflowStage(s, stage));
    }
    setAnalysisPercent((p) => Math.max(p, percent));
  }

  async function startAnalysis() {
    setError(null);
    setRateLimitModal(null);
    setLiveResult(null);
    const trimmed = domain.trim();
    if (!trimmed) {
      setError("Enter a company domain or URL.");
      return;
    }

    // Cancel sample walkthrough if a real run starts.
    sampleSimAbortRef.current?.abort();
    sampleSimAbortRef.current = null;
    setIsSimulatingSample(false);

    pollAbortRef.current?.abort();
    const abort = new AbortController();
    pollAbortRef.current = abort;

    setShowSample(false);
    setIsSubmitting(true);
    serverStageRef.current = "research";
    setWorkflowUiStage("research");
    setAnalysisPercent(8);
    setAnalysisLabel("Researching the company");
    setAnalysisDetail(
      "Looking for relevant business, growth and GTM signals.",
    );
    setAnalysisSeconds(0);
    requestAnimationFrame(() => scrollToStage("analysis"));

    const profileLabel = selectedProfileLabel();

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: trimmed,
          profileId,
          turnstileToken,
        }),
        signal: abort.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        jobId?: string;
        pollAfterMs?: number;
        mock?: boolean;
        rateLimit?: {
          limit?: number;
          remaining?: number;
          resetAt?: string;
        };
      };

      if (response.status === 429) {
        const lifetime =
          payload.error?.toLowerCase().includes("lifetime") ?? false;
        setRateLimitModal({
          title: lifetime
            ? "Demo lifetime limit reached"
            : "Daily demo limit reached",
          message:
            payload.error ??
            (lifetime
              ? "You have used all free analyses for this project."
              : "You have used today’s free analyses. Try again after the reset window."),
          resetAt: lifetime ? undefined : payload.rateLimit?.resetAt,
          limit: payload.rateLimit?.limit,
        });
        resetAnalysisUi();
        return;
      }

      if (response.status === 503) {
        setError(payload.error ?? "Server is at capacity. Try again shortly.");
        resetAnalysisUi();
        return;
      }

      if (!response.ok || !payload.jobId) {
        setError(payload.error ?? "Unable to start analysis.");
        setWorkflowUiStage("failed");
        resetAnalysisUi();
        return;
      }

      setAnalysisPercent(15);
      await pollJobUntilDone(
        payload.jobId,
        payload.pollAfterMs ?? 2000,
        profileLabel,
        abort.signal,
        {
          onStage: (stage, label, percent) => {
            applyStage(stage, label, percent);
          },
          onComplete: (result) => {
            setLiveResult(result);
            setShowSample(false);
            serverStageRef.current = "done";
            setWorkflowUiStage("done");
            setAnalysisPercent(100);
            setAnalysisLabel("Analysis complete");
            setAnalysisDetail("Your prospect report is ready.");
            setIsSubmitting(false);
            window.turnstile?.reset();
            setTurnstileToken("");
            scrollToResultsAfterComplete();
          },
          onFailed: (message) => {
            setError(message);
            serverStageRef.current = "failed";
            setWorkflowUiStage("failed");
            resetAnalysisUi();
          },
          onTimeout: () => {
            setError("Analysis timed out waiting for results. Try again.");
            serverStageRef.current = "failed";
            setWorkflowUiStage("failed");
            resetAnalysisUi();
          },
        },
      );
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;
      setWorkflowUiStage("failed");
      resetAnalysisUi();
      setError("Network error while starting analysis.");
    }
  }

  /**
   * Simulate the live-analysis path for the sample report (no workflow trigger).
   * Walks progress + workflow nodes, then opens the illustrative result.
   */
  async function viewSample() {
    if (isSubmitting || isSimulatingSample) return;

    pollAbortRef.current?.abort();
    sampleSimAbortRef.current?.abort();
    const abort = new AbortController();
    sampleSimAbortRef.current = abort;

    setError(null);
    setLiveResult(null);
    setShowSample(false);
    setIsSubmitting(false);
    setIsSimulatingSample(true);
    setShowScoreHow(false);
    setAnalysisSeconds(0);

    const steps: Array<{
      stage: WorkflowUiStage;
      label: string;
      detail: string;
      percent: number;
      holdMs: number;
    }> = [
      {
        stage: "research",
        label: "Researching the company",
        detail: "Looking for relevant business, growth and GTM signals.",
        percent: 18,
        holdMs: 1100,
      },
      {
        stage: "research",
        label: "Checking buying signals",
        detail: "Looking for reasons why outreach may be relevant now.",
        percent: 42,
        holdMs: 1100,
      },
      {
        stage: "strategy",
        label: "Building the sales strategy",
        detail: "Identifying the best contact role and outreach angle.",
        percent: 68,
        holdMs: 1200,
      },
      {
        stage: "scoring",
        label: "Evaluating prospect fit",
        detail: "Comparing the evidence against the selected ICP.",
        percent: 90,
        holdMs: 900,
      },
      {
        stage: "done",
        label: "Analysis complete",
        detail: "Your prospect report is ready.",
        percent: 100,
        holdMs: 450,
      },
    ];

    // Start at analysis so the walkthrough is visible.
    serverStageRef.current = "research";
    setWorkflowUiStage("research");
    setAnalysisPercent(8);
    setAnalysisLabel(steps[0].label);
    setAnalysisDetail(steps[0].detail);
    requestAnimationFrame(() => scrollToStage("analysis", { force: true }));

    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (abort.signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const t = window.setTimeout(() => resolve(), ms);
        abort.signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });

    try {
      for (const step of steps) {
        if (abort.signal.aborted) return;
        serverStageRef.current = step.stage;
        setWorkflowUiStage(step.stage);
        setAnalysisLabel(step.label);
        setAnalysisDetail(step.detail);
        setAnalysisPercent((p) => Math.max(p, step.percent));
        await sleep(step.holdMs);
      }
      if (abort.signal.aborted) return;

      setShowSample(true);
      setIsSimulatingSample(false);
      sampleSimAbortRef.current = null;
      scrollToResultsAfterComplete();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setIsSimulatingSample(false);
      sampleSimAbortRef.current = null;
    }
  }

  function startNewAnalysis() {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    sampleSimAbortRef.current?.abort();
    sampleSimAbortRef.current = null;
    setDomain("");
    setError(null);
    setRateLimitModal(null);
    setLiveResult(null);
    setShowSample(false);
    setIsSubmitting(false);
    setIsSimulatingSample(false);
    setAnalysisSeconds(0);
    setAnalysisPercent(0);
    setAnalysisLabel("Waiting for a company");
    setAnalysisDetail("Enter a company above to begin.");
    setWorkflowUiStage("idle");
    serverStageRef.current = "idle";
    setShowScoreHow(false);
    window.turnstile?.reset();
    setTurnstileToken("");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToStage("enter", { force: true }));
    });
  }

  const displayResult: DisplayResult | null = liveResult
    ? liveResult
    : showSample
      ? SAMPLE_RESULT
      : null;

  const selectOptions = profileOptions.map((p) => ({
    value: p.value,
    label: p.label,
  }));

  const analysisHeading =
    progressActive ||
    workflowUiStage === "done" ||
    workflowUiStage === "failed"
      ? "Researching the company and building your recommendation."
      : "See how the analysis works.";

  return (
    <main
      data-app-scroll
      className="h-screen snap-y snap-proximity overflow-y-auto scroll-smooth bg-[#09110f] text-stone-50"
    >
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      ) : null}
      {rateLimitModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[1.75rem] border border-white/15 bg-[#111816] p-6 shadow-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-200">
              Rate limit
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">
              {rateLimitModal.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-stone-300">
              {rateLimitModal.message}
            </p>
            {rateLimitModal.resetAt ? (
              <p className="mt-2 font-mono text-xs text-stone-500">
                Resets at {new Date(rateLimitModal.resetAt).toLocaleString()}
                {rateLimitModal.limit != null
                  ? ` · limit ${rateLimitModal.limit}/day`
                  : null}
              </p>
            ) : null}
            <button
              type="button"
              className={`mt-5 ${solidCtaClass()}`}
              onClick={() => setRateLimitModal(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      <div className="fixed left-5 top-1/2 z-40 hidden -translate-y-1/2 lg:block">
        <div className="flex flex-col gap-4 border-l border-white/25 pl-4">
          {appStages.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              onClick={() => scrollToStage(stage.id)}
              className="group flex items-center gap-3 text-left"
              aria-label={`Jump to ${stage.label}`}
            >
              <span
                className={`grid size-8 place-items-center border-l-4 text-sm font-black transition ${activeStage === stage.id ? "border-amber-300 bg-white text-slate-950" : "border-white/50 bg-slate-950 text-white group-hover:border-amber-200 group-hover:bg-white group-hover:text-slate-950"}`}
              >
                {index + 1}
              </span>
              <span
                className={`max-w-0 overflow-hidden whitespace-nowrap text-xs font-black uppercase tracking-[0.2em] transition-all group-hover:max-w-44 ${activeStage === stage.id ? "max-w-44 text-white" : "text-stone-200"}`}
              >
                {stage.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* —— Landing —— */}
      <section
        ref={landingRef}
        data-stage="landing"
        className="relative isolate flex min-h-screen snap-start items-center px-5 py-8 sm:px-8 lg:px-24"
      >
        <div className={`absolute inset-0 -z-10 ${slideBackground}`} />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-12">
          <nav className="flex items-center justify-between gap-4 rounded-full border border-white/10 bg-white/5 px-5 py-3 backdrop-blur">
            <span className="font-mono text-sm tracking-[0.12em] text-cyan-200">
              GTM Fit Analyzer
            </span>
            <div className="flex items-center gap-2">
              <a
                href="mailto:contact@marvinlossa.com?subject=GTM%20Fit%20Analyzer%20project%20inquiry"
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-200"
              >
                <span className="hidden sm:inline">Get in touch</span>
                <span className="sm:hidden">Contact</span>
              </a>
            </div>
          </nav>
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-7">
              <div className="inline-flex rounded-full border border-amber-200/20 bg-amber-200/10 px-4 py-2 text-sm text-amber-100">
                AI-assisted prospect research &amp; qualification
              </div>
              <div className="space-y-5">
                <h1 className="max-w-4xl text-5xl font-extrabold tracking-tight text-balance sm:text-7xl">
                  Find the prospects worth pursuing — and know why now.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-stone-300">
                  Enter a company domain and choose what a good prospect looks
                  like. The app researches public signals, scores the company
                  against your criteria, and turns the findings into a
                  practical sales strategy.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => scrollToStage("enter")}
                  className={primaryButtonClass()}
                >
                  Analyze a company
                </button>
                <button
                  type="button"
                  disabled={progressActive}
                  onClick={() => void viewSample()}
                  className={secondaryButtonClass()}
                >
                  {isSimulatingSample
                    ? "Running sample…"
                    : "View sample report"}
                </button>
              </div>
            </div>
            <div className="ml-auto w-full max-w-sm space-y-4">
              <div className="rounded-[1.75rem] border border-white/15 bg-black/25 p-4 backdrop-blur">
                <p className="px-2 pb-3 font-mono text-xs uppercase tracking-[0.22em] text-stone-300">
                  How it works
                </p>
                <div className="grid gap-2">
                  {[
                    {
                      title: "Enter a company",
                      body: "Add the prospect you want to evaluate.",
                    },
                    {
                      title: "Research & score fit",
                      body: "Find relevant company signals and compare them with your ICP.",
                    },
                    {
                      title: "Get a sales strategy",
                      body: "See why to approach them, who to target and what angle to use.",
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"
                    >
                      <p className="text-sm font-medium text-white">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-stone-400">
                        {item.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-white/10 bg-black/15 px-5 py-4 backdrop-blur">
                <div>
                  <p className="text-sm font-medium text-stone-200">
                    Designed and built by{" "}
                    <span className="whitespace-nowrap">Marvin Lossa</span>
                  </p>
                  <p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-stone-500">
                    Built with
                  </p>
                </div>
                <TechnologyMarks />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* —— Enter —— */}
      <section
        ref={enterRef}
        data-stage="enter"
        className={stageSectionClass()}
      >
        <div className={`absolute inset-0 -z-10 ${slideBackground}`} />
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div className="space-y-5">
            <p className={stageEyebrowClass("cyan")}>Company input</p>
            <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Choose a company and what good fit looks like.
            </h2>
            <p className="max-w-xl text-lg leading-8 text-stone-300">
              Enter the company you want to evaluate and select the Ideal
              Customer Profile that best represents the prospects you want to
              pursue.
            </p>
          </div>
          <div className={panelOuterClass()}>
            <div className={panelInnerClass()}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">
                    Prospect fit analysis
                  </h2>
                  <p className="text-sm text-stone-400">
                    1 company · 1 target profile
                  </p>
                </div>
                <Pill>{selectedProfileLabel()}</Pill>
              </div>
              <div className="grid gap-4">
                <TextEdit
                  label="Company domain or URL"
                  value={domain}
                  onChange={setDomain}
                  placeholder="e.g. acme.com"
                />
                <SelectEdit
                  label="Ideal Customer Profile (ICP)"
                  helper="Choose what your ideal prospect looks like."
                  value={profileId}
                  onChange={setProfileId}
                  options={selectOptions}
                />
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
                    Profile focus
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-300">
                    {selectedProfileBlurb()}
                  </p>
                </div>
              </div>
              {turnstileSiteKey ? (
                <div
                  className="cf-turnstile mt-4"
                  data-sitekey={turnstileSiteKey}
                  data-size="invisible"
                  data-theme="dark"
                  data-callback="onTurnstileSuccess"
                  data-expired-callback="onTurnstileExpired"
                  data-error-callback="onTurnstileExpired"
                />
              ) : null}
              <button
                type="button"
                disabled={progressActive || !domain.trim()}
                onClick={() => void startAnalysis()}
                className={`mt-5 ${solidCtaClass(progressActive || !domain.trim())}`}
              >
                {isSubmitting
                  ? "Starting analysis…"
                  : isSimulatingSample
                    ? "Sample running…"
                    : "Analyze prospect"}
              </button>
              {error ? (
                <p className="mt-4 rounded-2xl border border-red-300/30 bg-red-950/40 p-4 text-sm text-red-100">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* —— Analysis —— */}
      <section
        ref={analysisRef}
        data-stage="analysis"
        className={stageSectionClass()}
      >
        <div className={`absolute inset-0 -z-10 ${slideBackground}`} />
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
          <div className="space-y-5">
            <p className={stageEyebrowClass("amber")}>Live analysis</p>
            <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">
              {analysisHeading}
            </h2>
            <p className="max-w-xl text-lg leading-8 text-stone-300">
              Follow the analysis from company research through fit scoring to
              the final sales recommendation.
            </p>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-stone-200">
                  {analysisLabel}
                </span>
                {progressActive ? (
                  <span className="font-mono text-sm text-amber-200">
                    {analysisSeconds}s
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                {analysisDetail}
              </p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full bg-amber-300 transition-all duration-500 ${progressActive ? "animate-pulse" : ""}`}
                  style={{ width: `${analysisPercent}%` }}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
                  Powered by
                </span>
                <Pill tone="stone">n8n</Pill>
                <Pill tone="stone">Perplexity</Pill>
                <Pill tone="stone">OpenRouter</Pill>
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-400">
                {isSimulatingSample
                  ? "Sample walkthrough — no live research (illustrative only)."
                  : isSubmitting
                    ? "Analysis in progress…"
                    : displayResult
                      ? showSample
                        ? "Sample report ready — illustrative data only."
                        : (
                            <>
                              Analysis complete —{" "}
                              <button
                                type="button"
                                onClick={() =>
                                  scrollToStage("results", { force: true })
                                }
                                className="font-medium text-amber-100 underline-offset-2 hover:underline"
                              >
                                view prospect report
                              </button>
                              .
                            </>
                          )
                      : "Enter a company above to begin."}
              </p>
            </div>
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-stone-950/70 p-5 shadow-2xl shadow-amber-950/20 backdrop-blur">
            <WorkflowPanel stage={workflowUiStage} />
          </div>
        </div>
      </section>

      {/* —— Results —— */}
      <section
        ref={resultsRef}
        data-stage="results"
        className={stageSectionClass()}
      >
        <div className={`absolute inset-0 -z-10 ${slideBackground}`} />
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div className="space-y-5">
            <p className={stageEyebrowClass("cyan")}>Prospect report</p>
            <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Is this company worth pursuing?
            </h2>
            <p className="max-w-xl text-lg leading-8 text-stone-300">
              See how well the company matches your target profile, whether
              there is a reason to reach out now, who to approach and what
              angle to use.
            </p>
            {displayResult ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                        Company
                      </p>
                      <p className="mt-1 text-xl font-semibold">
                        {displayResult.domain}
                      </p>
                      <p className="mt-1 text-sm text-stone-400">
                        ICP · {displayResult.profileLabel}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {showSample ? (
                        <Pill tone="stone">Illustrative sample</Pill>
                      ) : null}
                      {displayResult.fitBand === "Insufficient data" ? (
                        <Pill tone="amber">Limited evidence</Pill>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-500">
                        Prospect fit
                      </p>
                      <p className="mt-2 text-3xl font-extrabold tracking-tight">
                        {displayResult.overallScore}
                        <span className="text-lg font-semibold text-stone-400">
                          /100
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-stone-400">
                        {displayResult.fitBand}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-500">
                        Buying signal
                      </p>
                      <p className="mt-2 text-3xl font-extrabold tracking-tight">
                        {displayResult.buyingSignal}
                      </p>
                      <p className="mt-1 text-sm text-stone-400">
                        Reason to engage now
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-500">
                        Priority
                      </p>
                      <p className="mt-2 text-3xl font-extrabold tracking-tight">
                        {displayResult.priority}
                      </p>
                      <p className="mt-1 text-sm text-stone-400">
                        Time worth spending
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-100/80">
                        Recommendation
                      </p>
                      <Pill tone={levelTone(displayResult.recommendation)}>
                        {displayResult.recommendation}
                      </Pill>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-200">
                      {displayResult.recommendationBlurb}
                    </p>
                  </div>
                </div>
                {showSample ? (
                  <p className="text-sm leading-6 text-stone-500">
                    Illustrative sample for Northwind Analytics — not a live
                    research run. Analyze a real domain for live results.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-6">
                <p className="text-lg font-semibold text-stone-200">
                  No prospect analyzed yet
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-400">
                  Your fit score and sales recommendation will appear here.
                </p>
                <button
                  type="button"
                  disabled={progressActive}
                  onClick={() => void viewSample()}
                  className={`mt-4 ${secondaryButtonClass()}`}
                >
                  {isSimulatingSample
                    ? "Running sample…"
                    : "View sample report"}
                </button>
              </div>
            )}
          </div>

          <div className={panelOuterClass()}>
            {displayResult ? (
              <div className="grid gap-5">
                {/* Why this company fits */}
                <div className={panelInnerClass()}>
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                    Why this company fits
                  </p>
                  <h3 className="mt-2 text-xl font-semibold">
                    ICP criteria vs public evidence
                  </h3>
                  <div className="mt-4 grid gap-3">
                    {displayResult.attributes.map((attr) => (
                      <div
                        key={attr.id}
                        className="rounded-2xl border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-stone-100">
                              {attr.label}
                            </p>
                            <p className="mt-1 text-xs text-stone-500">
                              {evidenceStrength(attr.present, attr.confidence)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-sm text-amber-200">
                              {attr.score}
                              <span className="text-stone-500">/100</span>
                            </p>
                            <span className="mt-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-stone-300">
                              {confidenceLabel(attr.confidence)}
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-stone-300">
                          {attr.evidence}
                        </p>
                        {attr.sourceLabel || attr.sourceUrl ? (
                          <p className="mt-2 text-xs text-stone-500">
                            Source:{" "}
                            {attr.sourceUrl ? (
                              <a
                                href={attr.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-cyan-200/90 underline-offset-2 hover:underline"
                              >
                                {attr.sourceLabel ?? "Open source"}
                              </a>
                            ) : (
                              (attr.sourceLabel ?? "Public web")
                            )}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Why now */}
                <div className="rounded-[1.5rem] border border-amber-300/20 bg-amber-300/[0.07] p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-200/90">
                    Why now?
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-100">
                    {displayResult.whyNowNarrative}
                  </p>
                  {displayResult.whyNowSignals.length > 0 ? (
                    <div className="mt-4 grid gap-2">
                      {displayResult.whyNowSignals.map((signal) => (
                        <div
                          key={`${signal.title}-${signal.detail.slice(0, 24)}`}
                          className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3"
                        >
                          <p className="text-sm font-medium text-amber-50">
                            {signal.title}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-stone-300">
                            {signal.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Who to approach */}
                <div className={panelInnerClass()}>
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                    Who to approach
                  </p>
                  <p className="mt-3 text-lg font-semibold text-stone-50">
                    {displayResult.whoToApproach}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-400">
                    {displayResult.whoToApproachWhy}
                  </p>
                  {displayResult.alternativeContact ? (
                    <p className="mt-3 text-sm text-stone-400">
                      <span className="font-medium text-stone-300">
                        Alternative:{" "}
                      </span>
                      {displayResult.alternativeContact}
                    </p>
                  ) : null}
                </div>

                {/* Likely challenge */}
                <div className={panelInnerClass()}>
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone-500">
                    Likely challenge
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    Working hypothesis — not confirmed internal fact
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-200">
                    {displayResult.likelyChallenge}
                  </p>
                </div>

                {/* Sales angle */}
                <div className={panelInnerClass()}>
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-200/80">
                    Recommended sales angle
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-200">
                    {displayResult.salesAngle}
                  </p>
                </div>

                {/* Conversation starter */}
                <div className={panelInnerClass()}>
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                    Conversation starter
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-200">
                    {displayResult.conversationStarter}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setShowScoreHow((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-stone-200"
                  >
                    How is the fit score calculated?
                    <span className="font-mono text-xs text-stone-500">
                      {showScoreHow ? "−" : "+"}
                    </span>
                  </button>
                  {showScoreHow ? (
                    <p className="mt-3 text-sm leading-6 text-stone-400">
                      Each profile defines weighted fit criteria. Company
                      research is evaluated against those criteria and the final
                      score is calculated consistently from the individual
                      results.
                    </p>
                  ) : null}
                </div>

                <p className="px-1 text-xs leading-5 text-stone-500">
                  {(displayResult.limitations ?? []).join(" ") ||
                    "Public-web estimate only — not investment or legal advice."}
                </p>
                <button
                  type="button"
                  onClick={startNewAnalysis}
                  className={solidCtaClass()}
                >
                  Analyze another company
                </button>
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-white/10 bg-[#111816] p-8 text-center">
                <p className="text-lg font-semibold text-stone-200">
                  No prospect analyzed yet
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-400">
                  Your fit score and sales recommendation will appear here.
                </p>
                <button
                  type="button"
                  disabled={progressActive}
                  onClick={() => void viewSample()}
                  className={`mt-5 ${secondaryButtonClass()}`}
                >
                  {isSimulatingSample
                    ? "Running sample…"
                    : "View sample report"}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
