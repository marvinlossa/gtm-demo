/**
 * Shared visual tokens and class helpers mirrored from Content Brief Creator
 * (`ContentBriefCreator/src/app/page.tsx`) so portfolio demos stay consistent.
 */

/** Dark gradient shell used on every full-viewport stage section. */
export const slideBackground =
  "bg-[radial-gradient(circle_at_top_left,#38bdf840,transparent_30%),radial-gradient(circle_at_82%_18%,#f59e0b2e,transparent_26%),linear-gradient(135deg,#09110f,#111827_58%,#0f172a)]";

/** Shared form control focus: amber ring only (no cyan, no double outline). */
export function inputClass() {
  return [
    "w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-stone-100",
    "outline-none ring-0 transition placeholder:text-stone-500",
    "focus:border-amber-300/55 focus:ring-4 focus:ring-amber-300/30",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/30",
  ].join(" ");
}

export function primaryButtonClass(disabled = false) {
  return disabled
    ? "rounded-full bg-stone-500 px-6 py-3 font-semibold text-stone-900 cursor-not-allowed"
    : "rounded-full bg-white px-6 py-3 font-semibold text-slate-950 transition hover:bg-amber-200";
}

export function secondaryButtonClass() {
  return "rounded-full border border-white/25 bg-white/[0.04] px-6 py-3 font-semibold text-white transition hover:border-cyan-200/70 hover:bg-white/10";
}

export function solidCtaClass(disabled = false) {
  return disabled
    ? "w-full rounded-2xl bg-stone-500 px-5 py-3 font-semibold text-stone-900 cursor-not-allowed"
    : "w-full rounded-2xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-200";
}

export function panelOuterClass() {
  return "rounded-[2rem] border border-white/10 bg-stone-950/70 p-5 shadow-2xl shadow-cyan-950/40 backdrop-blur";
}

export function panelInnerClass() {
  return "rounded-[1.5rem] border border-white/10 bg-[#111816] p-5";
}

export function stageEyebrowClass(tone: "cyan" | "amber" = "cyan") {
  return tone === "amber"
    ? "font-mono text-sm uppercase tracking-[0.28em] text-amber-200"
    : "font-mono text-sm uppercase tracking-[0.28em] text-cyan-200";
}

export function stageSectionClass() {
  return "relative isolate flex min-h-screen snap-start items-center px-5 py-10 sm:px-8 lg:px-24";
}

export type AppStage = "landing" | "enter" | "analysis" | "results";

export const appStages: { id: AppStage; label: string }[] = [
  { id: "landing", label: "Overview" },
  { id: "enter", label: "Company" },
  { id: "analysis", label: "Analysis" },
  { id: "results", label: "Report" },
];

/** Static seed labels for the enter form until /api/profiles loads. */
export const SEED_PROFILE_OPTIONS = [
  {
    id: "sales-expansion",
    label: "GTM Scale-Up",
    blurb:
      "Best for identifying growing B2B companies expanding sales teams, markets or commercial activity.",
  },
  {
    id: "product-led-growth",
    label: "Product-Led Growth",
    blurb:
      "Best for identifying companies where product, self-serve and product-qualified motions drive acquisition.",
  },
  {
    id: "enterprise-it-modernization",
    label: "Enterprise Modernization",
    blurb:
      "Best for identifying organizations modernizing IT with enterprise buyers, security needs and complex integrations.",
  },
] as const;
