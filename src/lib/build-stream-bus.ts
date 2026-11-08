/**
 * Live build events, persisted in Postgres (`BuildEvent`).
 *
 * The worker (or the inline worker inside Next) writes events; the SSE route tails them by
 * `seq`. Because the transport is the database, API and worker may run in different
 * processes or on different hosts.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type BuildStreamEventType =
  | "status"
  | "activity"
  | "assistant"
  | "preview"
  | "phase"
  | "error"
  | "agent_done"
  | "done";

export type BuildStreamEvent = {
  /** Stable event id. For persisted events this is the `BuildEvent.seq` as a string. */
  id: string;
  type: BuildStreamEventType;
  message?: string;
  text?: string;
  url?: string;
  tool?: string;
  path?: string;
  callId?: string;
  /** Tool / run status from agent */
  agentStatus?: string;
  /** Terminal BuildRun status on done */
  runStatus?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  /** On `done`: true when a new deployment went live (client should refresh the preview). */
  previewChanged?: boolean;
};

type EventDraft = Omit<BuildStreamEvent, "id">;

/** Assistant text deltas are merged for this long before being written (limits DB writes). */
const ASSISTANT_COALESCE_MS = 300;

type RunWriter = {
  chain: Promise<void>;
  pendingText: string;
  timer: ReturnType<typeof setTimeout> | null;
};

const writers = new Map<string, RunWriter>();

function getWriter(buildRunId: string): RunWriter {
  let w = writers.get(buildRunId);
  if (!w) {
    w = { chain: Promise.resolve(), pendingText: "", timer: null };
    writers.set(buildRunId, w);
  }
  return w;
}

function draftToRow(buildRunId: string, draft: EventDraft) {
  const { type, message, ...rest } = draft;
  const payload = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined)
  ) as Prisma.InputJsonObject;
  return {
    buildRunId,
    eventType: type,
    message: message ?? null,
    payload: Object.keys(payload).length ? payload : undefined,
  };
}

function enqueueWrite(buildRunId: string, draft: EventDraft) {
  const w = getWriter(buildRunId);
  w.chain = w.chain
    .then(async () => {
      await prisma.buildEvent.create({ data: draftToRow(buildRunId, draft) });
    })
    .catch((e) => {
      console.error("[build-events] write failed", buildRunId, draft.type, e);
    });
}

function flushAssistant(buildRunId: string) {
  const w = writers.get(buildRunId);
  if (!w) return;
  if (w.timer) {
    clearTimeout(w.timer);
    w.timer = null;
  }
  if (w.pendingText) {
    const text = w.pendingText;
    w.pendingText = "";
    enqueueWrite(buildRunId, { type: "assistant", text });
  }
}

/**
 * Record a live event for a build run. Synchronous for callers; writes are ordered per run.
 * Call `flushBuildStream` before a run's process work ends to make sure everything is stored.
 */
export function publishBuildStream(
  buildRunId: string,
  type: BuildStreamEventType,
  payload?: Omit<BuildStreamEvent, "id" | "type">
) {
  if (type === "assistant") {
    const text = payload?.text ?? "";
    if (!text) return;
    const w = getWriter(buildRunId);
    w.pendingText += text;
    if (!w.timer) {
      w.timer = setTimeout(() => flushAssistant(buildRunId), ASSISTANT_COALESCE_MS);
    }
    return;
  }
  // Keep ordering: pending assistant text goes out before the next non-assistant event.
  flushAssistant(buildRunId);
  enqueueWrite(buildRunId, { type, ...payload });
}

/** Wait until every event published so far for this run is stored in Postgres. */
export async function flushBuildStream(buildRunId: string): Promise<void> {
  flushAssistant(buildRunId);
  const w = writers.get(buildRunId);
  if (!w) return;
  await w.chain;
  if (!w.timer && !w.pendingText) writers.delete(buildRunId);
}

function rowToEvent(row: {
  seq: bigint;
  eventType: string;
  message: string | null;
  payload: Prisma.JsonValue | null;
}): BuildStreamEvent {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Partial<BuildStreamEvent>)
      : {};
  return {
    ...payload,
    id: row.seq.toString(),
    type: row.eventType as BuildStreamEventType,
    message: row.message ?? payload.message,
  };
}

/** Events for a run with `seq` greater than `afterSeq`, oldest first. */
export async function readBuildEventsAfter(
  buildRunId: string,
  afterSeq: bigint,
  limit = 200
): Promise<{ events: BuildStreamEvent[]; lastSeq: bigint }> {
  const rows = await prisma.buildEvent.findMany({
    where: { buildRunId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
    take: limit,
    select: { seq: true, eventType: true, message: true, payload: true },
  });
  const lastSeq = rows.length ? rows[rows.length - 1].seq : afterSeq;
  return { events: rows.map(rowToEvent), lastSeq };
}

const EVENT_RETENTION_DAYS = 7;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
let lastPruneAt = 0;

/** Delete old events; cheap enough to call opportunistically (throttled per process). */
export async function maybePruneBuildEvents(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  const cutoff = new Date(now - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const res = await prisma.buildEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (res.count > 0) console.log(`[build-events] pruned ${res.count} events older than ${EVENT_RETENTION_DAYS}d`);
  } catch (e) {
    console.error("[build-events] prune failed", e);
  }
}

export function streamEventToSse(
  event: BuildStreamEvent
): { sseEvent: string; data: Record<string, unknown> } {
  const eventId = event.id;
  switch (event.type) {
    case "assistant":
      return { sseEvent: "assistant", data: { eventId, text: event.text ?? "" } };
    case "preview":
      return { sseEvent: "preview", data: { eventId, url: event.url ?? "" } };
    case "phase":
      return { sseEvent: "phase", data: { eventId, status: event.runStatus, message: event.message } };
    case "activity":
      return {
        sseEvent: "activity",
        data: {
          eventId,
          message: event.message ?? "",
          tool: event.tool,
          path: event.path,
          callId: event.callId,
          status: event.agentStatus,
        },
      };
    case "error":
      return { sseEvent: "error", data: { eventId, message: event.message ?? "Error" } };
    case "agent_done":
      return {
        sseEvent: "agent_done",
        data: {
          eventId,
          status: event.runStatus,
          errorMessage: event.errorMessage,
          finishedAt: event.finishedAt,
        },
      };
    case "done":
      return {
        sseEvent: "done",
        data: {
          eventId,
          status: event.runStatus,
          errorMessage: event.errorMessage,
          startedAt: event.startedAt,
          finishedAt: event.finishedAt,
          previewChanged: event.previewChanged,
        },
      };
    default:
      return { sseEvent: "status", data: { eventId, message: event.message ?? "" } };
  }
}
