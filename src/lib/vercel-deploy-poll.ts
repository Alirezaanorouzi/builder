/** Interval between Vercel deployment readiness checks after an agent run. */
export const VERCEL_DEPLOY_POLL_INTERVAL_MS = 30_000;

/** How many polls before giving up (excluding the first immediate check). */
export const VERCEL_DEPLOY_POLL_MAX_ATTEMPTS = 10;

/** Client preview waiting screen — slightly longer than server poll window. */
export const VERCEL_DEPLOY_POLL_MAX_WAIT_MS =
  VERCEL_DEPLOY_POLL_MAX_ATTEMPTS * VERCEL_DEPLOY_POLL_INTERVAL_MS + 20_000;

export function vercelDeployPollOptions() {
  return {
    maxAttempts: VERCEL_DEPLOY_POLL_MAX_ATTEMPTS,
    delayMs: VERCEL_DEPLOY_POLL_INTERVAL_MS,
  } as const;
}
