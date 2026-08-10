import { sweepExpiredJobs, sweepTimedOutJobs } from "@/lib/jobs";

let interval: ReturnType<typeof setInterval> | null = null;

export function runSweepOnce() {
  const timedOut = sweepTimedOutJobs();
  const expired = sweepExpiredJobs();
  if (timedOut || expired) {
    console.info(
      JSON.stringify({
        event: "job_sweep",
        timedOut,
        expired,
        at: new Date().toISOString(),
      }),
    );
  }
  return { timedOut, expired };
}

/** Start process-level sweeper (single replica). Idempotent. */
export function ensureSweeper() {
  if (interval || process.env.DISABLE_JOB_SWEEPER === "1") return;
  interval = setInterval(() => {
    try {
      runSweepOnce();
    } catch (error) {
      console.error("[gtm-demo] sweeper error", error);
    }
  }, 30_000);
  // Don't keep the process alive solely for the timer in some environments.
  if (typeof interval === "object" && interval && "unref" in interval) {
    interval.unref();
  }
}
