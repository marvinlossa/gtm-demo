import { sweepExpiredJobs, sweepTimedOutJobs } from "@/lib/jobs";

/** Drop timed-out and expired jobs. Called from read/write paths, not a timer. */
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
