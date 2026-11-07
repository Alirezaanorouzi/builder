/** How many polls before giving up. */
export const VERCEL_DEPLOY_POLL_MAX_ATTEMPTS = 20;

/** Poll fast while the build is young, then back off (Vercel builds typically take 30-120s). */
export function vercelDeployPollDelayMs(attempt: number): number {
  if (attempt < 6) return 10_000;
  if (attempt < 12) return 15_000;
  return 20_000;
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
