/** How many polls before giving up. */
export const VERCEL_DEPLOY_POLL_MAX_ATTEMPTS = 20;

/** Transient list-API failures in a row before treating Vercel as unreachable (same poll window). */
export const VERCEL_POLL_MAX_CONSECUTIVE_FAILURES = 6;

/** First ~30s after confirm: 3s cadence; then back off as build may still be young. */
export function vercelDeployPollDelayMs(attempt: number): number {
  if (attempt < 10) return 3_000;
  if (attempt < 24) return 8_000;
  return 15_000;
}

/** Upper bound of a full poll window (server side cap). */
export const VERCEL_DEPLOY_POLL_MAX_WAIT_MS = (() => {
  let total = 0;
  for (let i = 0; i < VERCEL_DEPLOY_POLL_MAX_ATTEMPTS; i++) total += vercelDeployPollDelayMs(i);
  return total;
})();

export function vercelDeployPollOptions() {
  return {
    maxAttempts: VERCEL_DEPLOY_POLL_MAX_ATTEMPTS,
  } as const;
}
