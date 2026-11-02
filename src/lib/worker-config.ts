export type WorkerMode = "all" | "builds" | "provisioning";

const VALID: WorkerMode[] = ["all", "builds", "provisioning"];

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
