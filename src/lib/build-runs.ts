import { prisma } from "@/lib/db";
import { getCodingEngineId } from "@/lib/config";
import type { BuildRunStatus, CodingEngine, Prisma } from "@prisma/client";
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
  engine?: CodingEngine;
}) {
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
      status: "queued",
    },
  });
}

export async function appendBuildEvent(
  buildRunId: string,
  eventType: string,
  options?: { message?: string; payload?: Record<string, unknown> }
) {
  return prisma.buildEvent.create({
    data: {
      buildRunId,
      eventType,
      message: options?.message ?? null,
      payload: options?.payload
        ? (options.payload as Prisma.InputJsonValue)
        : undefined,
    },
  });
}

export function engineEventToBuildEventType(event: EngineStreamEvent): {
  eventType: string;
  message?: string;
  payload?: Record<string, unknown>;
} {
  switch (event.type) {
    case "status":
      return { eventType: "status", message: event.message };
    case "assistant":
      return { eventType: "assistant", payload: { text: event.text } };
    case "activity":
      return { eventType: "activity", message: event.message };
    case "error":
      return { eventType: "error", message: event.message };
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
  return prisma.buildRun.update({
    where: { id: buildRunId },
    data: {
      status,
      ...patch,
      updatedAt: new Date(),
    },
  });
}

export async function listBuildEventsSince(buildRunId: string, afterCreatedAt?: Date) {
  return prisma.buildEvent.findMany({
    where: {
      buildRunId,
      ...(afterCreatedAt ? { createdAt: { gt: afterCreatedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}
