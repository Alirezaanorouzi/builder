/**
 * In-process pub/sub for live build SSE (not persisted to Postgres).
 * Requires worker + API in the same Node process (INLINE_BUILD_WORKER=1 or Next dev).
 */

export type BuildStreamEventType =
  | "status"
  | "activity"
  | "assistant"
  | "preview"
  | "error"
  | "agent_done"
  | "done";

export type BuildStreamEvent = {
  id: string;
  type: BuildStreamEventType;
  message?: string;
  text?: string;
  url?: string;
  tool?: string;
  path?: string;
  /** Tool / run status from agent */
  agentStatus?: string;
  /** Terminal BuildRun status on done */
  runStatus?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
};

type Listener = (event: BuildStreamEvent) => void;

const MAX_BUFFER = 256;

class BuildStreamBus {
  private listeners = new Map<string, Set<Listener>>();
  private buffer = new Map<string, BuildStreamEvent[]>();

  publish(buildRunId: string, event: BuildStreamEvent) {
    const buf = this.buffer.get(buildRunId) ?? [];
    buf.push(event);
    while (buf.length > MAX_BUFFER) buf.shift();
    this.buffer.set(buildRunId, buf);
    for (const fn of this.listeners.get(buildRunId) ?? []) {
      fn(event);
    }
  }

  subscribe(buildRunId: string, listener: Listener): () => void {
    let set = this.listeners.get(buildRunId);
    if (!set) {
      set = new Set();
      this.listeners.set(buildRunId, set);
    }
    set.add(listener);
    for (const ev of this.buffer.get(buildRunId) ?? []) {
      listener(ev);
    }
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(buildRunId);
    };
  }

  drop(buildRunId: string) {
    this.buffer.delete(buildRunId);
    this.listeners.delete(buildRunId);
  }
}

const globalKey = "__builderBuildStreamBus";

function getBus(): BuildStreamBus {
  const g = globalThis as unknown as Record<string, BuildStreamBus | undefined>;
  if (!g[globalKey]) g[globalKey] = new BuildStreamBus();
  return g[globalKey]!;
}

export const buildStreamBus = getBus();

export function publishBuildStream(
  buildRunId: string,
  type: BuildStreamEventType,
  payload?: Omit<BuildStreamEvent, "id" | "type">
) {
  buildStreamBus.publish(buildRunId, {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    ...payload,
  });
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
    case "activity":
      return {
        sseEvent: "activity",
        data: {
          eventId,
          message: event.message ?? "",
          tool: event.tool,
          path: event.path,
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
        },
      };
    default:
      return { sseEvent: "status", data: { eventId, message: event.message ?? "" } };
  }
}
