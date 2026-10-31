import { prisma } from "@/lib/db";
import { executeBuildRun } from "@/lib/execute-build-run";
import type { BuildRun } from "@prisma/client";

/** Claim one queued job using Postgres SKIP LOCKED (safe for multiple workers). */
export async function claimNextQueuedBuildRun(): Promise<BuildRun | null> {
  const rows = await prisma.$queryRaw<BuildRun[]>`
    UPDATE "BuildRun"
    SET
      status = 'preparing_workspace'::"BuildRunStatus",
      "startedAt" = COALESCE("startedAt", NOW()),
      "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "BuildRun"
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

export async function runBuildWorkerLoop(options?: { pollMs?: number }) {
  const pollMs = options?.pollMs ?? 2000;
  // eslint-disable-next-line no-console
  console.log("[build-worker] listening for queued BuildRuns…");
  for (;;) {
    try {
      const didWork = await processOneBuildJob();
      if (!didWork) {
        await new Promise((r) => setTimeout(r, pollMs));
      }
    } catch (e) {
      console.error("[build-worker]", e);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
