import type { Prisma } from "@prisma/client";
import {
  applyRawActivityEvent,
  finalizeAgentActivity,
  terminalPhaseFromRunStatus,
  type AgentActivitySnapshot,
} from "@/lib/agent-activity";
import type { BuildStreamEvent, BuildStreamEventType } from "@/lib/build-stream-bus";
import { parseStoredPromptImages, storedImagesToSdk } from "@/lib/prompt-images";
import { prisma } from "@/lib/db";
import type { BuildRunStatus } from "@prisma/client";

export type ChatReplayItem =
  | {
      id: string;
      kind: "user";
      text: string;
      imagePreviews?: string[];
    }
  | { id: string; kind: "assistant"; text: string; buildRunId: string }
  | { id: string; kind: "agentActivity"; buildRunId: string; snapshot: AgentActivitySnapshot }
  | { id: string; kind: "error"; text: string };

function rowToEvent(row: {
  seq: bigint;
  eventType: string;
  message: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}): BuildStreamEvent & { atMs: number } {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Partial<BuildStreamEvent>)
      : {};
  return {
    ...payload,
    id: row.seq.toString(),
    type: row.eventType as BuildStreamEventType,
    message: row.message ?? payload.message,
    atMs: row.createdAt.getTime(),
  };
}

function initialSnapshot(startedAtMs: number): AgentActivitySnapshot {
  return {
    phase: "working",
    startedAtMs,
    timeline: [],
    expanded: false,
  };
}

export async function buildChatItemsForRun(run: {
  id: string;
  userMessage: string;
  promptImages: Prisma.JsonValue | null;
  status: BuildRunStatus;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): Promise<ChatReplayItem[]> {
  const events = await prisma.buildEvent.findMany({
    where: { buildRunId: run.id },
    orderBy: { seq: "asc" },
    select: { seq: true, eventType: true, message: true, payload: true, createdAt: true },
  });

  const images = parseStoredPromptImages(run.promptImages);
  const imagePreviews =
    images.length > 0
      ? storedImagesToSdk(images).map((img) =>
          img.data.startsWith("data:") ? img.data : `data:image/jpeg;base64,${img.data}`
        )
      : undefined;

  const items: ChatReplayItem[] = [
    {
      id: `${run.id}-user`,
      kind: "user",
      text: run.userMessage,
      ...(imagePreviews?.length ? { imagePreviews } : {}),
    },
  ];

  const startedAtMs = run.startedAt?.getTime() ?? run.createdAt.getTime();
  let snapshot = initialSnapshot(startedAtMs);
  const seen = new Set<string>();
  let assistantText = "";
  let postAgentError: string | undefined;

  for (const row of events) {
    const ev = rowToEvent(row);
    switch (ev.type) {
      case "assistant":
        assistantText += ev.text ?? "";
        snapshot = { ...snapshot, receivedAssistant: true };
        break;
      case "activity":
        snapshot = applyRawActivityEvent(
          snapshot,
          {
            eventId: ev.id,
            kind: "activity",
            message: ev.message ?? "",
            meta: {
              tool: ev.tool,
              path: ev.path,
              callId: ev.callId,
              status: ev.agentStatus,
            },
            atMs: ev.atMs,
          },
          seen
        );
        break;
      case "status":
        if (ev.message?.trim()) {
          snapshot = applyRawActivityEvent(
            snapshot,
            {
              eventId: ev.id,
              kind: "status",
              message: ev.message,
              atMs: ev.atMs,
            },
            seen
          );
        }
        break;
      case "phase":
        if (ev.message?.trim()) {
          snapshot = applyRawActivityEvent(
            snapshot,
            {
              eventId: ev.id,
              kind: "status",
              message: ev.message,
              atMs: ev.atMs,
            },
            seen
          );
        }
        break;
      case "error":
        snapshot = applyRawActivityEvent(
          snapshot,
          {
            eventId: ev.id,
            kind: "error",
            message: ev.message ?? "خطایی رخ داد",
            atMs: ev.atMs,
          },
          seen
        );
        break;
      case "agent_done":
        if (ev.runStatus === "succeeded") {
          snapshot = finalizeAgentActivity(snapshot, "completed", {
            endedAtMs: ev.finishedAt ? Date.parse(ev.finishedAt) : ev.atMs,
          });
        } else {
          snapshot = finalizeAgentActivity(snapshot, "failed", {
            endedAtMs: ev.finishedAt ? Date.parse(ev.finishedAt) : ev.atMs,
            errorMessage: ev.errorMessage,
          });
        }
        break;
      case "done":
        if (ev.errorMessage) postAgentError = ev.errorMessage;
        break;
      default:
        break;
    }
  }

  const terminal = terminalPhaseFromRunStatus(run.status);
  if (snapshot.phase === "working" && terminal) {
    snapshot = finalizeAgentActivity(snapshot, terminal, {
      endedAtMs: run.finishedAt?.getTime(),
      errorMessage: run.errorMessage ?? undefined,
    });
  } else if (snapshot.phase === "working" && run.errorMessage) {
    snapshot = finalizeAgentActivity(snapshot, "failed", {
      endedAtMs: run.finishedAt?.getTime(),
      errorMessage: run.errorMessage,
    });
  }

  const showActivity =
    snapshot.timeline.length > 0 ||
    snapshot.receivedAssistant ||
    snapshot.phase !== "working" ||
    events.some((e) => e.eventType !== "assistant");

  if (showActivity) {
    items.push({
      id: `${run.id}-activity`,
      kind: "agentActivity",
      buildRunId: run.id,
      snapshot: { ...snapshot, expanded: false },
    });
  }

  const assistant = assistantText.trim();
  if (assistant) {
    items.push({
      id: `${run.id}-assistant`,
      kind: "assistant",
      buildRunId: run.id,
      text: assistant,
    });
  }

  const err = postAgentError ?? (run.status === "failed" ? run.errorMessage : null);
  if (err && snapshot.phase === "completed") {
    items.push({ id: `${run.id}-post-error`, kind: "error", text: err });
  }

  return items;
}
