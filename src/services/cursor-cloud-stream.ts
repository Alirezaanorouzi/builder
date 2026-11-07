import { cursorAuthHeader, cursorStreamUrl } from "@/services/cursor.service";
import type { EngineStreamEvent } from "@engines/types";

function toolPathFromPayload(payload: Record<string, unknown>): string | undefined {
  const args = payload.args;
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    for (const key of ["path", "file_path", "target_file", "filePath", "relative_workspace_path"]) {
      if (typeof a[key] === "string" && a[key]) return a[key] as string;
    }
  }
  for (const key of ["path", "file_path", "target_file"]) {
    if (typeof payload[key] === "string" && payload[key]) return payload[key] as string;
  }
  return undefined;
}

function labelForTool(name: string, path: string | undefined): string {
  const n = name.toLowerCase();
  if (n.includes("read") && path) return `Read ${path}`;
  if ((n.includes("write") || n.includes("edit") || n.includes("replace")) && path) {
    return `Edited ${path}`;
  }
  if (n.includes("grep") || n.includes("search")) return path ? `Searched ${path}` : "Searched codebase";
  if (n.includes("list") || n.includes("glob")) return path ? `Explored ${path}` : "Explored files";
  if (n.includes("terminal") || n.includes("run_terminal")) return "Ran terminal command";
  if (path) return `${name}: ${path}`;
  return name;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_STREAM_RECONNECTS = 24;
const MAX_BACKOFF_MS = 8000;

/**
 * Live Cloud Agent SSE (`/v1/agents/.../stream`). Parses events like the Cursor dashboard.
 * Reconnects with `Last-Event-ID` when the connection drops before a terminal `result` event
 * (needed for serverless gateways with `maxDuration`).
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

  while (!runFinished && reconnectAttempt <= MAX_STREAM_RECONNECTS) {
    const upstream = await openStream();

    if (upstream.status === 410) {
      // Stream window expired; caller should use `getCursorRun` for the outcome.
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

    try {
      while (true) {
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

          if (eventType === "thinking") continue;

          if (eventType === "assistant") {
            const text = String(payload.text ?? "");
            if (text.trim()) onEvent({ type: "assistant", text });
            continue;
          }

          if (eventType === "tool_call") {
            const name = String(payload.name ?? "");
            const status = String(payload.status ?? "");
            if (status !== "running") continue;
            const path = toolPathFromPayload(payload);
            onEvent({
              type: "activity",
              message: labelForTool(name, path),
              meta: { tool: name, status, path },
            });
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
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (runFinished) return true;

    // Connection closed before a terminal event — reconnect if we can resume.
    reconnectAttempt += 1;
    if (reconnectAttempt > MAX_STREAM_RECONNECTS) break;
    await sleep(Math.min(800 * reconnectAttempt, MAX_BACKOFF_MS));
  }

  return runFinished;
}
