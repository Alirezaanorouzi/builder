import { prisma, withDbRetry } from "@/lib/db";
import { getCodingEngineId } from "@/lib/config";
import { flushBuildStream, publishBuildStream } from "@/lib/build-stream-bus";
import type { BuildRunStatus, CodingEngine } from "@prisma/client";
import type { EngineStreamEvent } from "@engines/types";
import { HttpError } from "@/lib/access";

export const ACTIVE_BUILD_STATUSES: BuildRunStatus[] = [
  "queued",
  "preparing_workspace",
  "running",
  "pushing",
  "deploying",
];

/** Blocks queuing another user message while the agent is still working. */
export const AGENT_EXCLUSIVE_BUILD_STATUSES: BuildRunStatus[] = [
  "queued",
  "preparing_workspace",
  "running",
];

export const TERMINAL_BUILD_STATUSES: BuildRunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/** A live worker touches its run this often (BuildRun.updatedAt). */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** No heartbeat for this long => the worker that owned the run is gone; recover it. */
export const HEARTBEAT_STALE_MS = 90_000;

/**
 * Deferred deploy confirmation: worker stopped heartbeating but Vercel may already be READY.
 * Retry sooner than agent-recovery stale (must exceed max Vercel poll gap ~20s).
 */
export const DEPLOY_CONFIRM_RETRY_STALE_MS = 30_000;

/** Never re-queue a run older than this (avoids crash loops on a poisoned job). */
const REQUEUE_MAX_AGE_MS = 30 * 60 * 1000;

/** Hard cap on a single run's wall-clock time (agent + deploy). */
function buildRunMaxMs(): number {
  const raw = Number(process.env.BUILD_RUN_MAX_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 45;
  return minutes * 60 * 1000;
}

function buildRunIdleStaleMs(): number {
  const raw = process.env.BUILD_RUN_STALE_MINUTES?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n * 60 * 1000;
  }
  return process.env.NODE_ENV === "development" ? 3 * 60 * 1000 : 20 * 60 * 1000;
}

function queuedWithoutWorkerMs(): number {
  return process.env.NODE_ENV === "development" ? 90 * 1000 : 5 * 60 * 1000;
}

/** Mark an interrupted run terminal so a new build can be queued. */
export async function failInterruptedBuildRun(buildRunId: string, message: string) {
  const finishedAt = new Date();
  await updateBuildRunStatus(buildRunId, "failed", {
    errorMessage: message,
    finishedAt,
  });
  publishBuildStream(buildRunId, "error", { message });
  publishBuildStream(buildRunId, "done", {
    runStatus: "failed",
    errorMessage: message,
    finishedAt: finishedAt.toISOString(),
  });
  await flushBuildStream(buildRunId);
}

/**
 * Start a liveness heartbeat for a run owned by this process. Returns a stop function.
 * Recovery treats a run without a recent heartbeat as orphaned.
 */
export function startBuildRunHeartbeat(buildRunId: string): () => void {
  const timer = setInterval(() => {
    void touchBuildRun(buildRunId);
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * Fail active runs that cannot recover (nobody picked them up, or they ran too long).
 * A restart alone does NOT fail a run: the Cursor agent keeps working remotely and a worker
 * re-attaches to it (`recoverStaleBuildRun`). Call before enqueueing a new build for the site.
 */
export async function reconcileStaleActiveBuildsForSite(siteId: string): Promise<void> {
  const actives = await prisma.buildRun.findMany({
    where: { siteId, status: { in: ACTIVE_BUILD_STATUSES } },
    orderBy: { createdAt: "asc" },
  });

  for (const run of actives) {
    if (run.status === "queued") {
      const waitMs = Date.now() - run.createdAt.getTime();
      if (waitMs > queuedWithoutWorkerMs()) {
        await failInterruptedBuildRun(
          run.id,
          "Build stayed queued too long. Start the worker or enable INLINE_BUILD_WORKER=1."
        );
      }
      continue;
    }

    if (Date.now() - run.createdAt.getTime() > buildRunMaxMs()) {
      await failInterruptedBuildRun(run.id, "Build exceeded the maximum allowed duration.");
      continue;
    }

    const lastActivity = run.updatedAt ?? run.startedAt ?? run.createdAt;
    const idleMs = Date.now() - lastActivity.getTime();
    if (idleMs > buildRunIdleStaleMs()) {
      // No worker recovered it for a long time: nobody is running builds.
      await failInterruptedBuildRun(run.id, "Build timed out with no activity (no worker running?).");
    }
  }
}

/**
 * Runs claimed by a worker that died before the Cursor agent run started (no `engineRunId`):
 * safe to put back in the queue.
 */
export async function requeueOrphanedBuildRuns(): Promise<number> {
  const staleBefore = new Date(Date.now() - HEARTBEAT_STALE_MS);
  const newerThan = new Date(Date.now() - REQUEUE_MAX_AGE_MS);
  const res = await prisma.buildRun.updateMany({
    where: {
      status: { in: ["preparing_workspace", "running"] },
      engineRunId: null,
      updatedAt: { lt: staleBefore },
      createdAt: { gt: newerThan },
    },
    data: { status: "queued", updatedAt: new Date() },
  });
  return res.count;
}

/**
 * Atomically claim ONE run whose worker died after the agent run started
 * (has `engineRunId`, stale heartbeat). The claim bumps `updatedAt`, so only one worker wins.
 */
/** Re-attach to a run stuck in publish after defer (short stale window). */
export async function claimStaleDeployConfirmationRun() {
  const staleBefore = new Date(Date.now() - DEPLOY_CONFIRM_RETRY_STALE_MS);
  const candidate = await prisma.buildRun.findFirst({
    where: {
      status: { in: ["pushing", "deploying"] },
      engineRunId: { not: null },
      updatedAt: { lt: staleBefore },
    },
    orderBy: { updatedAt: "asc" },
  });
  if (!candidate) return null;

  const claimed = await prisma.buildRun.updateMany({
    where: { id: candidate.id, status: candidate.status, updatedAt: candidate.updatedAt },
    data: { updatedAt: new Date() },
  });
  return claimed.count === 1 ? candidate : null;
}

export async function claimStaleBuildRunForRecovery() {
  const staleBefore = new Date(Date.now() - HEARTBEAT_STALE_MS);
  const candidate = await prisma.buildRun.findFirst({
    where: {
      status: { in: ["running"] },
      engineRunId: { not: null },
      updatedAt: { lt: staleBefore },
    },
    orderBy: { updatedAt: "asc" },
  });
  if (!candidate) return null;

  const claimed = await prisma.buildRun.updateMany({
    where: { id: candidate.id, status: candidate.status, updatedAt: candidate.updatedAt },
    data: { updatedAt: new Date() },
  });
  return claimed.count === 1 ? candidate : null;
}

export async function findActiveBuildForSite(siteId: string) {
  return prisma.buildRun.findFirst({
    where: { siteId, status: { in: ACTIVE_BUILD_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

export async function findAgentExclusiveBuildForSite(siteId: string) {
  return prisma.buildRun.findFirst({
    where: { siteId, status: { in: AGENT_EXCLUSIVE_BUILD_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createQueuedBuildRun(options: {
  siteId: string;
  chatSessionId: string;
  userMessage: string;
  promptImages?: import("@/lib/prompt-images").StoredPromptImage[];
  engine?: CodingEngine;
}) {
  await reconcileStaleActiveBuildsForSite(options.siteId);

  const active = await findAgentExclusiveBuildForSite(options.siteId);
  if (active) {
    throw new HttpError(
      "The agent is still working on the previous request. Wait a moment or try again.",
      409
    );
  }

  const engine = options.engine ?? (getCodingEngineId() as CodingEngine);
  return prisma.buildRun.create({
    data: {
      siteId: options.siteId,
      chatSessionId: options.chatSessionId,
      engine,
      userMessage: options.userMessage,
      promptImages: options.promptImages?.length ? options.promptImages : undefined,
      status: "queued",
    },
  });
}

/** Record a coding-engine stream event (persisted to `BuildEvent`; the SSE route tails it). */
export function publishEngineStreamEvent(buildRunId: string, event: EngineStreamEvent) {
  switch (event.type) {
    case "status":
      publishBuildStream(buildRunId, "status", { message: event.message });
      break;
    case "assistant":
      publishBuildStream(buildRunId, "assistant", { text: event.text });
      break;
    case "activity":
      publishBuildStream(buildRunId, "activity", {
        message: event.message,
        tool: event.meta?.tool,
        path: event.meta?.path,
        callId: event.meta?.callId,
        agentStatus: event.meta?.status,
      });
      break;
    case "error":
      publishBuildStream(buildRunId, "error", { message: event.message });
      break;
    case "agent_done":
      publishBuildStream(buildRunId, "agent_done", {
        runStatus: event.status === "succeeded" ? "succeeded" : "failed",
        errorMessage: event.errorMessage,
        finishedAt: event.finishedAt,
      });
      break;
  }
}

export async function updateBuildRunStatus(
  buildRunId: string,
  status: BuildRunStatus,
  patch?: {
    engineRunId?: string;
    commitSha?: string;
    deploymentId?: string;
    deployUrl?: string;
    errorMessage?: string;
    startedAt?: Date;
    finishedAt?: Date;
  }
) {
  return withDbRetry(() =>
    prisma.buildRun.update({
      where: { id: buildRunId },
      data: {
        status,
        ...patch,
        updatedAt: new Date(),
      },
    })
  );
}

export function publishBuildRunDone(
  buildRunId: string,
  run: {
    status: BuildRunStatus;
    errorMessage?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
  options?: { previewChanged?: boolean }
) {
  const finishedAt = run.finishedAt ?? new Date();
  publishBuildStream(buildRunId, "done", {
    runStatus: run.status,
    errorMessage: run.errorMessage ?? undefined,
    startedAt: run.startedAt?.toISOString(),
    finishedAt: finishedAt.toISOString(),
    previewChanged: options?.previewChanged,
  });
}

/** Heartbeat: mark an active run as alive (used while polling Vercel / streaming the agent). */
export async function touchBuildRun(buildRunId: string) {
  await withDbRetry(() =>
    prisma.buildRun.update({
      where: { id: buildRunId },
      data: { updatedAt: new Date() },
    })
  ).catch(() => undefined);
}
