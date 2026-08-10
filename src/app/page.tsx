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

type DisplayAttribute = {
  id: string;
  label: string;
  score: number;
  present: string;
  confidence: number;
  evidence: string;
};

type DisplayResult = {
  domain: string;
  profileLabel: string;
  overallScore: number;
  fitBand: string;
  attributes: DisplayAttribute[];
  strategy: {
    summary: string;
    talkTracks: string[];
    nextSteps: string[];
  };
  limitations?: string[];
  mock?: boolean;
};

/**
 * Client-only sample so recruiters can see layout without burning quota.
 * Always framed seller → prospect (reader analyzes a potential client).
 */
const SAMPLE_RESULT: DisplayResult = {
  domain: "northwind-analytics.com",
  profileLabel: "Sales Expansion",
  overallScore: 74,
  fitBand: "Moderate fit",
  attributes: [
    {
      id: "growing-sales-team",
      label: "Growing sales team",
      score: 82,
      present: "true",
      confidence: 0.8,
      evidence:
        "Careers lists AE + SDR openings in US and EMEA; blog notes GTM headcount growth after the raise (illustrative sample).",
    },
    {
      id: "recent-funding",
      label: "Recent funding",
      score: 88,
      present: "true",
      confidence: 0.85,
      evidence:
        "Press room cites a Series B led by a growth fund to scale go-to-market (illustrative sample).",
    },
    {
      id: "b2b-offering",
      label: "B2B offering",
      score: 91,
      present: "true",
      confidence: 0.9,
      evidence:
        "Team/enterprise pricing and case studies aimed at mid-market analytics buyers (illustrative sample).",
    },
    {
      id: "clear-sales-org",
      label: "Clear sales organization",
      score: 68,
      present: "true",
      confidence: 0.7,
      evidence:
        "Leadership page lists a VP of Sales; enterprise page describes AE-led evaluation (illustrative sample).",
    },
  ],
  strategy: {
    summary:
      "Outbound plan for selling into Northwind Analytics (prospect), not running their company. Moderate Sales Expansion fit: public hiring + funding suggest GTM capacity pressure. First thread: prospect RevOps or VP Sales. Open on AE ramp / handoff friction; propose a 30-day pilot on one pod with a single pipeline or ramp metric.",
    talkTracks: [
      "Cold email / call open: “Saw Northwind posting AEs after the Series B — teams in that phase often hit marketing→sales handoff friction. Worth a 15-minute compare against what peers do on ramp?”",
      "Discovery bridge: “If multi-threaded deals are common for your analytics buyers, champions usually need a one-page ROI brief. Happy to leave one tailored to Northwind’s motion.”",
    ],
    nextSteps: [
      "Map public AE/SDR openings and 2–3 prospect stakeholders (VP Sales, RevOps, CRO)",
      "Draft a 3-touch outbound sequence to those titles — seller voice, not an internal memo to Northwind",
      "Offer a 30-day pilot scoped to one Northwind sales pod with one success metric",
    ],
  },
  limitations: [
    "Illustrative sample only — not live research.",
    "Public-web estimate style; not investment or legal advice.",
  ],
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
      evidence: Array<{ snippet: string }>;
    }>;
    strategy: {
      summary: string;
      talkTracks?: Array<{ title?: string; script?: string } | string>;
      nextSteps?: string[];
    };
    limitations?: string[];
  } | null;
};

function mapJobToDisplay(
  job: JobPollResponse,
  profileLabel: string,
): DisplayResult | null {
  if (!job.result) return null;
  const talkTracks = (job.result.strategy.talkTracks ?? []).map((t) => {
    if (typeof t === "string") return t;
    if (t.title && t.script) return `${t.title}: ${t.script}`;
    return t.script ?? t.title ?? "";
  }).filter(Boolean);

  return {
    domain: job.domain,
    profileLabel,
    overallScore: job.result.overallScore,
    fitBand: job.result.fitBand,
    attributes: job.result.attributes.map((a) => ({
      id: a.attributeId,
      label: a.label,
      score: a.attributeScore,
      present: a.present,
      confidence: a.confidence,
      evidence: a.evidence?.[0]?.snippet ?? "No evidence snippet.",
    })),
    strategy: {
      summary: job.result.strategy.summary,
      talkTracks,
      nextSteps: job.result.strategy.nextSteps ?? [],
    },
    limitations: job.result.limitations,
  };
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

    // Server stage is authoritative; parent applies monotonic advance.
    if (job.stage === "strategy") {
      handlers.onStage("strategy", "Drafting sales strategy", 70);
    } else if (job.stage === "research") {
      handlers.onStage("research", "Researching company signals", 40);
    } else if (job.stage === "scoring" || job.stage === "done") {
      handlers.onStage("scoring", "Scoring attributes", 96);
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
  const [showSample, setShowSample] = useState(false);
  const [liveResult, setLiveResult] = useState<DisplayResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [rateLimitModal, setRateLimitModal] = useState<RateLimitModal | null>(
    null,
  );
  const [workflowUiStage, setWorkflowUiStage] =
    useState<WorkflowUiStage>("idle");
  const [analysisSeconds, setAnalysisSeconds] = useState(0);
  const [analysisPercent, setAnalysisPercent] = useState(0);
  const [analysisLabel, setAnalysisLabel] = useState("Waiting for a domain");

  const landingRef = useRef<HTMLElement>(null);
  const enterRef = useRef<HTMLElement>(null);
  const analysisRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  /** Highest stage seen from server polls — heuristic must not override this. */
  const serverStageRef = useRef<WorkflowUiStage>("idle");

  function scrollToStage(stage: AppStage, options?: { force?: boolean }) {
    const el = ({
      landing: landingRef,
      enter: enterRef,
      analysis: analysisRef,
      results: resultsRef,
    })[stage].current;
    if (!el) return;

    // Scroll the snap container (`main`), not just the window — scrollIntoView
    // alone often fails or gets cancelled under CSS scroll-snap.
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
    // Second pass after layout (results content mount, fonts, snap settle)
    if (options?.force) {
      window.setTimeout(run, 80);
      window.setTimeout(run, 280);
    }
  }

  /** After React commits result state, scroll to Results reliably. */
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
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const stage = visible?.target.getAttribute(
          "data-stage",
        ) as AppStage | null;
        if (stage) setActiveStage(stage);
      },
      { threshold: [0.35, 0.55, 0.75] },
    );
    for (const ref of sectionRefs) {
      if (ref.current) observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isSubmitting) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setAnalysisSeconds(Math.floor(elapsed / 1000));

      // Progress bar only from elapsed time (monotonic fill).
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

      // Stage theater is strictly monotonic and never overrides a higher server stage.
      // Bug we fixed: after 45s heuristic forced "strategy" while poll still returned
      // stage=research every 2s → UI jumped research ↔ strategy.
      const server = serverStageRef.current;
      if (
        server === "done" ||
        server === "failed" ||
        server === "scoring" ||
        server === "strategy"
      ) {
        // Label for long waits once strategy is already known
        if (server === "strategy" && elapsed >= 100_000) {
          setAnalysisLabel((label) =>
            label.startsWith("Scoring") || label.startsWith("Complete")
              ? label
              : "Finalizing",
          );
        }
        return;
      }

      if (elapsed < 45_000) {
        setWorkflowUiStage((s) => advanceWorkflowStage(s, "research"));
        setAnalysisLabel("Researching company signals");
      } else {
        // Optimistic advance only when server has not yet reported strategy.
        setWorkflowUiStage((s) => advanceWorkflowStage(s, "strategy"));
        setAnalysisLabel(
          elapsed < 100_000 ? "Drafting sales strategy" : "Finalizing",
        );
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [isSubmitting]);

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
    setAnalysisLabel("Waiting for a domain");
    window.turnstile?.reset();
    setTurnstileToken("");
  }

  function applyStage(stage: WorkflowUiStage, label: string, percent: number) {
    const prev = serverStageRef.current;
    const next = advanceWorkflowStage(prev, stage);
    serverStageRef.current = next;
    // Only rewrite label when we actually advance (or first set) — avoids
    // "Researching"/"Drafting" thrash when poll re-sends an older stage.
    if (WORKFLOW_STAGE_RANK[next] > WORKFLOW_STAGE_RANK[prev] || prev === "idle") {
      setWorkflowUiStage(next);
      setAnalysisLabel(label);
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

    pollAbortRef.current?.abort();
    const abort = new AbortController();
    pollAbortRef.current = abort;

    setShowSample(false);
    setIsSubmitting(true);
    serverStageRef.current = "research";
    setWorkflowUiStage("research");
    setAnalysisPercent(8);
    setAnalysisLabel("Starting job");
    setAnalysisSeconds(0);
    setJobId(null);
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
        setRateLimitModal({
          title: "Daily demo limit reached",
          message:
            payload.error ??
            "You have used today’s free analyses. Try again after the reset window.",
          resetAt: payload.rateLimit?.resetAt,
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

      setJobId(payload.jobId);
      setAnalysisLabel(
        payload.mock ? "Mock orchestration running" : "Workflow running",
      );
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
            setAnalysisLabel("Complete");
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

  function viewSample() {
    pollAbortRef.current?.abort();
    setError(null);
    setLiveResult(null);
    setShowSample(true);
    setIsSubmitting(false);
    serverStageRef.current = "done";
    setWorkflowUiStage("done");
    setAnalysisPercent(100);
    setAnalysisLabel("Sample result ready");
    scrollToResultsAfterComplete();
  }

  /** Clear form + result state and return to Enter for another run. */
  function startNewAnalysis() {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    setDomain("");
    setError(null);
    setRateLimitModal(null);
    setLiveResult(null);
    setShowSample(false);
    setJobId(null);
    setIsSubmitting(false);
    setAnalysisSeconds(0);
    setAnalysisPercent(0);
    setAnalysisLabel("Waiting for a domain");
    setWorkflowUiStage("idle");
    serverStageRef.current = "idle";
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
                n8n-orchestrated GTM research workflow
              </div>
              <div className="space-y-5">
                <h1 className="max-w-4xl text-5xl font-extrabold tracking-tight text-balance sm:text-7xl">
                  Score ICP fit from a domain — then open the sales playbook.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-stone-300">
                  Pick a GTM profile, research public company signals with
                  Perplexity, score attributes transparently, and generate a
                  tailored sales strategy via OpenRouter.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => scrollToStage("enter")}
                  className={primaryButtonClass()}
                >
                  Run the live demo
                </button>
                <button
                  type="button"
                  onClick={viewSample}
                  className={secondaryButtonClass()}
                >
                  View sample result
                </button>
              </div>
            </div>
            <div className="ml-auto w-full max-w-sm space-y-4">
              <div className="rounded-[1.75rem] border border-white/15 bg-black/25 p-4 backdrop-blur">
                <p className="px-2 pb-3 font-mono text-xs uppercase tracking-[0.22em] text-stone-300">
                  Workflow
                </p>
                <div className="grid gap-2">
                  {[
                    "Enter domain + ICP profile",
                    "n8n research & strategy",
                    "Display fit score + playbook",
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white"
                    >
                      {item}
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
              Start with the target company.
            </h2>
            <p className="max-w-xl text-lg leading-8 text-stone-300">
              Provide a domain and the ICP profile you sell into. Analysis runs
              through n8n — research first, then strategy, then app-side scoring.
            </p>
          </div>
          <div className={panelOuterClass()}>
            <div className={panelInnerClass()}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Fit analysis</h2>
                  <p className="text-sm text-stone-400">
                    Domain + one GTM profile
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
                  label="ICP / fit profile"
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
                disabled={isSubmitting || !domain.trim()}
                onClick={() => void startAnalysis()}
                className={`mt-5 ${solidCtaClass(isSubmitting || !domain.trim())}`}
              >
                {isSubmitting ? "Starting analysis..." : "Analyze company fit"}
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
            <p className={stageEyebrowClass("amber")}>Live orchestration</p>
            <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Research, score, strategize.
            </h2>
            <p className="max-w-xl text-lg leading-8 text-stone-300">
              n8n runs Perplexity and OpenRouter. The app persists the job,
              applies transparent scoring, and streams status back to this
              panel.
            </p>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-stone-200">
                  {analysisLabel}
                </span>
                {isSubmitting ? (
                  <span className="font-mono text-sm text-amber-200">
                    {analysisSeconds}s
                  </span>
                ) : null}
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full bg-amber-300 transition-all duration-500 ${isSubmitting ? "animate-pulse" : ""}`}
                  style={{ width: `${analysisPercent}%` }}
                />
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-400">
                {isSubmitting
                  ? jobId
                    ? `Polling job ${jobId.slice(0, 8)}… every 2s.`
                    : "Creating analysis job…"
                  : displayResult
                    ? showSample
                      ? "Sample path — no Turnstile, no quota."
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
                              view results
                            </button>
                            .
                          </>
                        )
                    : "Submit a domain on the Enter stage to start."}
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
            <p className={stageEyebrowClass("cyan")}>Fit report</p>
            <h2 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Transparent score and strategy.
            </h2>
            <p className="max-w-xl text-lg leading-8 text-stone-300">
              Each attribute shows presence, confidence, and evidence. Strategy
              is grounded in what research actually found.
            </p>
            {displayResult ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                      Overall fit
                    </p>
                    <p className="mt-2 text-5xl font-extrabold tracking-tight">
                      {displayResult.overallScore}
                    </p>
                    <p className="mt-1 text-sm text-stone-400">
                      {displayResult.fitBand} · {displayResult.domain}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {showSample ? (
                      <Pill tone="stone">Illustrative sample</Pill>
                    ) : null}
                    {displayResult.fitBand === "Insufficient data" ? (
                      <Pill tone="amber">Limited evidence</Pill>
                    ) : null}
                    <Pill tone="amber">{displayResult.profileLabel}</Pill>
                  </div>
                </div>
                {showSample ? (
                  <p className="mt-4 text-sm leading-6 text-stone-400">
                    Dummy layout preview for Northwind Analytics — not a live
                    research run. Run Analyze for real Perplexity + strategy
                    output. Strategy is always seller → prospect (you are
                    evaluating a potential client).
                  </p>
                ) : null}
                {displayResult.fitBand === "Insufficient data" ? (
                  <p className="mt-4 text-sm leading-6 text-amber-100/90">
                    Limited public evidence — score is not a reliable fit
                    judgment.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-sm text-stone-400">
                Results appear here after a successful analysis. Use{" "}
                <button
                  type="button"
                  onClick={viewSample}
                  className="font-medium text-amber-100 underline-offset-2 hover:underline"
                >
                  View sample result
                </button>{" "}
                to preview the layout (illustrative dummy data).
              </div>
            )}
          </div>
          <div className={panelOuterClass()}>
            {displayResult ? (
              <div className="grid gap-5">
                <div className={panelInnerClass()}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-200/80">
                        Attribute scores
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">
                        Evidence by signal
                      </h3>
                    </div>
                    <Pill tone="stone">
                      {displayResult.attributes.length} attributes
                    </Pill>
                  </div>
                  <div className="grid gap-3">
                    {displayResult.attributes.map((attr) => (
                      <div
                        key={attr.id}
                        className="rounded-2xl border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-stone-100">
                            {attr.label}
                          </span>
                          <span className="font-mono text-sm text-amber-200">
                            {attr.score}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-stone-400">
                          {attr.evidence}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-200/80">
                    Sales strategy
                  </p>
                  <p className="mt-3 text-sm leading-7 text-stone-200">
                    {displayResult.strategy.summary}
                  </p>
                  <ul className="mt-4 grid gap-2">
                    {displayResult.strategy.talkTracks.map((track) => (
                      <li
                        key={track}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-stone-300"
                      >
                        {track}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
                      Next steps
                    </p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-300">
                      {displayResult.strategy.nextSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                </div>
                <p className="px-1 text-xs leading-5 text-stone-500">
                  {(displayResult.limitations ?? []).join(" ") ||
                    "Public-web estimate only — not investment or legal advice."}
                  {showSample ? " Sample data is illustrative." : null}
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
              <div className="rounded-[1.5rem] border border-white/10 bg-[#111816] p-8 text-center text-sm text-stone-400">
                No result yet. Complete Enter → Analysis, or open the sample.
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
