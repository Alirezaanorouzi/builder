import { prisma, withDbRetry } from "@/lib/db";
import { getCodingEngineId } from "@/lib/config";
import { publishBuildStream } from "@/lib/build-stream-bus";
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

export const TERMINAL_BUILD_STATUSES: BuildRunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/** When this Node process booted — active runs not touched since then are orphaned (e.g. dev restart). */
const PROCESS_STARTED_AT = Date.now();

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
}

/**
 * Fail active runs that cannot still be executing (server restart, dead worker, idle agent).
 * Call before enqueueing a new build for the site.
 */
export async function reconcileStaleActiveBuildsForSite(siteId: string): Promise<void> {
  const actives = await prisma.buildRun.findMany({
    where: { siteId, status: { in: ACTIVE_BUILD_STATUSES } },
    orderBy: { createdAt: "asc" },
  });

  const processStart = new Date(PROCESS_STARTED_AT);

  for (const run of actives) {
    if (run.updatedAt < processStart) {
      await failInterruptedBuildRun(
        run.id,
        "Previous build did not finish (app restarted or worker stopped)."
      );
      continue;
    }

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

    const lastActivity = run.updatedAt ?? run.startedAt ?? run.createdAt;
    const idleMs = Date.now() - lastActivity.getTime();
    if (idleMs > buildRunIdleStaleMs()) {
      await failInterruptedBuildRun(run.id, "Build timed out with no activity.");
    }
  }
}

export async function findActiveBuildForSite(siteId: string) {
  return prisma.buildRun.findFirst({
    where: { siteId, status: { in: ACTIVE_BUILD_STATUSES } },
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

  const active = await findActiveBuildForSite(options.siteId);
  if (active) {
    throw new HttpError(
      "A build is already in progress for this site. Wait for it to finish.",
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

/** Push a coding-engine stream event to in-memory SSE subscribers (not Postgres). */
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
  }
) {
  const finishedAt = run.finishedAt ?? new Date();
  publishBuildStream(buildRunId, "done", {
    runStatus: run.status,
    errorMessage: run.errorMessage ?? undefined,
    startedAt: run.startedAt?.toISOString(),
    finishedAt: finishedAt.toISOString(),
  });
}
