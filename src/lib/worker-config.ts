export type WorkerMode = "all" | "builds" | "provisioning";

const VALID: WorkerMode[] = ["all", "builds", "provisioning"];

/**
 * Run build + provisioning worker inside the web process (Liara single-app default).
 * Set `INLINE_BUILD_WORKER=0` on the web app when a separate `npm run worker` app handles jobs.
 */
export function isInlineBuildWorkerEnabled(): boolean {
  const raw = (process.env.INLINE_BUILD_WORKER ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return true;
}

export function getWorkerConfig() {
  const raw = process.env.WORKER_MODE?.trim().toLowerCase() ?? "all";
  const mode = (VALID.includes(raw as WorkerMode) ? raw : "all") as WorkerMode;
  const workerId =
    process.env.WORKER_ID?.trim() ||
    `worker-${typeof process.pid === "number" ? process.pid : "local"}`;
  const pollMs = Math.max(500, Number(process.env.WORKER_POLL_MS ?? 2000) || 2000);
  const leaseMinutes = Math.max(1, Number(process.env.PROVISIONING_LEASE_MINUTES ?? 10) || 10);
  return { mode, workerId, pollMs, leaseMinutes };
}
