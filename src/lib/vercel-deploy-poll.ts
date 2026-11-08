/** Wall-clock budget for one confirmDeployments poll session (slow Next builds). */
export const VERCEL_DEPLOY_POLL_DEADLINE_MS = 5 * 60 * 1000;

/** Safety cap on poll iterations (deadline is the real limit). */
export const VERCEL_DEPLOY_POLL_MAX_ATTEMPTS = 80;

/** Transient list-API failures in a row before treating Vercel as unreachable (same poll window). */
export const VERCEL_POLL_MAX_CONSECUTIVE_FAILURES = 6;

/** After this many deferred publish recoveries, fail the run instead of looping. */
export const MAX_DEPLOY_CONFIRM_RECOVERIES = 4;

/** First ~30s after confirm: 3s cadence; then back off as build may still be young. */
export function vercelDeployPollDelayMs(attempt: number): number {
  if (attempt < 10) return 3_000;
  if (attempt < 40) return 8_000;
  return 15_000;
}

/** Upper bound of a full poll window if every attempt runs (deadline may stop earlier). */
export const VERCEL_DEPLOY_POLL_MAX_WAIT_MS = (() => {
  let total = 0;
  for (let i = 0; i < VERCEL_DEPLOY_POLL_MAX_ATTEMPTS; i++) total += vercelDeployPollDelayMs(i);
  return total;
})();

export function vercelDeployPollOptions() {
  return {
    maxAttempts: VERCEL_DEPLOY_POLL_MAX_ATTEMPTS,
    deadlineMs: VERCEL_DEPLOY_POLL_DEADLINE_MS,
  } as const;
}
