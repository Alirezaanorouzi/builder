import { prisma } from "@/lib/db";
import { executeBuildRun } from "@/services/build-orchestrator";
import { processOneProvisioningJob } from "@/services/provisioning.service";
import { getWorkerConfig } from "@/lib/worker-config";
import { reconcileStaleActiveBuildsForSite } from "@/lib/build-runs";
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

export async function processOneBuildJob(): Promise<boolean> {
  const claimed = await claimNextQueuedBuildRun();
  if (!claimed) return false;
  await executeBuildRun(claimed.id);
  return true;
}

/** Builds first, then provisioning (respects WORKER_MODE). */
/** Fire one worker tick when INLINE_BUILD_WORKER=1 (logs failures instead of unhandled rejections). */
export function kickInlineWorkerTick() {
  if (process.env.INLINE_BUILD_WORKER !== "1") return;
  void processOneWorkerTick().catch((e) => console.error("[inline-worker]", e));
}

export async function processOneWorkerTick(): Promise<boolean> {
  const { mode, workerId, leaseMinutes } = getWorkerConfig();

  if (mode === "all" || mode === "builds") {
    if (await processOneBuildJob()) return true;
  }
  if (mode === "all" || mode === "provisioning") {
    if (await processOneProvisioningJob(workerId, leaseMinutes)) return true;
  }
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
