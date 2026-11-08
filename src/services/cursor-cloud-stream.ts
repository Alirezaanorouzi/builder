import { cursorAuthHeader, cursorStreamUrl } from "@/services/cursor.service";
import type { EngineStreamEvent } from "@engines/types";
import {
  formatToolActivityLabel,
  isLongRunningTool,
  pathFromToolPayload,
} from "@/lib/cursor-tool-labels";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_STREAM_RECONNECTS = 24;
const MAX_BACKOFF_MS = 8000;

/**
 * Live Cloud Agent SSE (`/v1/agents/.../stream`).
 * Uses simplified events only (`tool_call`, `assistant`, `result`) — not `interaction_update`.
 * Reconnects with `Last-Event-ID` when the connection drops before a terminal `result` event.
 */
export async function streamCloudAgentRun(
  agentId: string,
  runId: string,
  onEvent: (event: EngineStreamEvent) => void
): Promise<boolean> {
  let lastEventId: string | undefined;
  let reconnectAttempt = 0;
  let runFinished = false;

  async function openStream(): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: cursorAuthHeader(),
      Accept: "text/event-stream",
    };
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;
    return fetch(cursorStreamUrl(agentId, runId), { headers });
  }

  function emitToolCall(payload: Record<string, unknown>) {
    const callId = typeof payload.callId === "string" ? payload.callId : "";
    const name = String(payload.name ?? "");
    const status = String(payload.status ?? "");
    if (status !== "running" && status !== "completed") return;
    if (!name) return;

    const path = pathFromToolPayload(payload.args, payload.result);
    const message = formatToolActivityLabel(name, path);

    const meta = {
      tool: name,
      status,
      path,
      ...(callId ? { callId } : {}),
    };

    if (status === "running") {
      if (!isLongRunningTool(name)) return;
      onEvent({ type: "activity", message, meta });
      return;
    }

    onEvent({ type: "activity", message, meta: { ...meta, status: "completed" } });
  }

  while (!runFinished && reconnectAttempt <= MAX_STREAM_RECONNECTS) {
    const upstream = await openStream();

    if (upstream.status === 410) {
      return runFinished;
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      if (reconnectAttempt < MAX_STREAM_RECONNECTS) {
        reconnectAttempt += 1;
        await sleep(Math.min(500 * reconnectAttempt, MAX_BACKOFF_MS));
        continue;
      }
      throw new Error(`Cursor stream failed (${upstream.status}): ${text}`);
    }

    reconnectAttempt = 0;

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let stopReading = false;

    try {
      while (!stopReading) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const block of parts) {
          if (!block.trim()) continue;

          let eventType = "message";
          let dataLine = "";

          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
            else if (line.startsWith("id:")) {
              const id = line.slice(3).trim();
              if (id) lastEventId = id;
            }
          }

          if (!dataLine) continue;

          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(dataLine) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (eventType === "thinking" || eventType === "heartbeat" || eventType === "interaction_update") {
            continue;
          }

          if (eventType === "assistant") {
            const text = String(payload.text ?? "");
            if (text.trim()) onEvent({ type: "assistant", text });
            continue;
          }

          if (eventType === "tool_call") {
            emitToolCall(payload);
            continue;
          }

          if (eventType === "result") {
            const status = String(payload.status ?? "").toUpperCase();
            if (status === "FINISHED") {
              runFinished = true;
              onEvent({
                type: "agent_done",
                status: "succeeded",
                finishedAt: new Date().toISOString(),
              });
            } else if (status === "ERROR" || status === "FAILED" || status === "CANCELLED") {
              runFinished = true;
              onEvent({
                type: "agent_done",
                status: "failed",
                errorMessage:
                  typeof payload.error === "string"
                    ? payload.error
                    : `Agent run ${status.toLowerCase()}`,
                finishedAt: new Date().toISOString(),
              });
            }
            if (runFinished) {
              stopReading = true;
              void reader.cancel().catch(() => {});
              break;
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* cancelled */
      }
    }

    if (runFinished) return true;

    reconnectAttempt += 1;
    if (reconnectAttempt > MAX_STREAM_RECONNECTS) break;
    await sleep(Math.min(800 * reconnectAttempt, MAX_BACKOFF_MS));
  }

  return runFinished;
}
