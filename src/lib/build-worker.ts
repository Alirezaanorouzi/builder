import { prisma } from "@/lib/db";
import { executeBuildRun } from "@/services/build-orchestrator";
import { processOneProvisioningJob } from "@/services/provisioning.service";
import type { BuildRun } from "@prisma/client";

/** Claim one queued job (SQLite-safe; use a single worker process). */
export async function claimNextQueuedBuildRun(): Promise<BuildRun | null> {
  return prisma.$transaction(async (tx) => {
    const next = await tx.buildRun.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;

    return tx.buildRun.update({
      where: { id: next.id },
      data: {
        status: "preparing_workspace",
        startedAt: next.startedAt ?? new Date(),
      },
    });
  });
}

export async function processOneBuildJob(): Promise<boolean> {
  const claimed = await claimNextQueuedBuildRun();
  if (!claimed) return false;
  await executeBuildRun(claimed.id);
  return true;
}

/** Builds first, then provisioning (single worker loop). */
export async function processOneWorkerTick(): Promise<boolean> {
  if (await processOneBuildJob()) return true;
  return processOneProvisioningJob();
}

export async function runBuildWorkerLoop(options?: { pollMs?: number }) {
  const pollMs = options?.pollMs ?? 2000;
  // eslint-disable-next-line no-console
  console.log("[worker] builds + provisioning…");
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
