import { prisma } from "@/lib/db";
import { processOneProvisioningJob } from "@/services/provisioning.service";
import { getWorkerConfig, isInlineBuildWorkerEnabled } from "@/lib/worker-config";
import {
  claimStaleBuildRunForRecovery,
  claimStaleDeployConfirmationRun,
  reconcileStaleActiveBuildsForSite,
  requeueOrphanedBuildRuns,
} from "@/lib/build-runs";
import { maybePruneBuildEvents } from "@/lib/build-stream-bus";
import { kickUsageSync } from "@/services/quota.service";
import type { BuildRun } from "@prisma/client";

/** Claim one queued job (Postgres `FOR UPDATE SKIP LOCKED`). */
export async function claimNextQueuedBuildRun(): Promise<BuildRun | null> {
  const rows = await prisma.$queryRaw<BuildRun[]>`
    UPDATE "BuildRun"
    SET
      status = 'preparing_workspace'::"BuildRunStatus",
      "startedAt" = COALESCE("startedAt", NOW()),
      "updatedAt" = NOW()
    WHERE id = (
      SELECT id
      FROM "BuildRun"
      WHERE status = 'queued'::"BuildRunStatus"
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Runs whose worker died: put never-started ones back in the queue, and re-attach to the
 * Cursor run of the ones that already started. Returns true if a run was recovered.
 */
export async function recoverOrphanedBuildRuns(): Promise<boolean> {
  const requeued = await requeueOrphanedBuildRuns();
  if (requeued > 0) console.log(`[worker] re-queued ${requeued} orphaned build run(s)`);

  const deployStale = await claimStaleDeployConfirmationRun();
  const stale = deployStale ?? (await claimStaleBuildRunForRecovery());
  if (!stale) return false;
  console.log(`[worker] recovering build run ${stale.id} (was ${stale.status})`);
  const { recoverBuildRun } = await import("@/services/build-orchestrator");
  await recoverBuildRun(stale.id);
  return true;
}

export async function processOneBuildJob(): Promise<boolean> {
  if (await recoverOrphanedBuildRuns()) return true;
  const claimed = await claimNextQueuedBuildRun();
  if (!claimed) return false;
  const { executeBuildRun } = await import("@/services/build-orchestrator");
  await executeBuildRun(claimed.id);
  return true;
}

/** Builds first, then provisioning (respects WORKER_MODE). */
/** Nudge one worker tick (e.g. right after queueing). The background loop also polls continuously. */
export function kickInlineWorkerTick() {
  if (!isInlineBuildWorkerEnabled()) return;
  ensureInlineWorkerLoop();
  void processOneWorkerTick().catch((e) => console.error("[inline-worker]", e));
}

let inlineLoopStarted = false;

export function isInlineWorkerLoopRunning(): boolean {
  return inlineLoopStarted;
}

/** Start the background poll loop once per process (must not run from instrumentation — webpack). */
export function ensureInlineWorkerLoop() {
  if (!isInlineBuildWorkerEnabled() || inlineLoopStarted) return;
  inlineLoopStarted = true;
  void runBuildWorkerLoop().catch((e) => console.error("[inline-worker-loop]", e));
}

export async function processOneWorkerTick(): Promise<boolean> {
  const { mode, workerId, leaseMinutes } = getWorkerConfig();

  // Throttled (every few hours per process): drop old live-event rows.
  void maybePruneBuildEvents();

  if (mode === "all" || mode === "builds") {
    if (await processOneBuildJob()) return true;
  }
  if (mode === "all" || mode === "provisioning") {
    if (await processOneProvisioningJob(workerId, leaseMinutes)) return true;
  }
  kickUsageSync();
  return false;
}

export async function runBuildWorkerLoop(options?: { pollMs?: number }) {
  const cfg = getWorkerConfig();
  const pollMs = options?.pollMs ?? cfg.pollMs;
  const sites = await prisma.buildRun.findMany({
    where: { status: { in: ["queued", "preparing_workspace", "running", "pushing", "deploying"] } },
    select: { siteId: true },
    distinct: ["siteId"],
  });
  for (const { siteId } of sites) {
    await reconcileStaleActiveBuildsForSite(siteId);
  }
  // eslint-disable-next-line no-console
  console.log(`[worker] mode=${cfg.mode} id=${cfg.workerId} poll=${pollMs}ms`);
  for (;;) {
    try {
      const didWork = await processOneWorkerTick();
      if (!didWork) {
        await new Promise((r) => setTimeout(r, pollMs));
      }
    } catch (e) {
      console.error("[worker]", e);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
