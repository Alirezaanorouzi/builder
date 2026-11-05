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

/**
 * Live Cloud Agent SSE (`/v1/agents/.../stream`) — same wire format Cursor dashboard uses.
 * SDK `run.stream()` often omits cloud tool events; REST stream is reliable for UI.
 */
export async function streamCloudAgentRun(
  agentId: string,
  runId: string,
  onEvent: (event: EngineStreamEvent) => void
): Promise<boolean> {
  const upstream = await fetch(cursorStreamUrl(agentId, runId), {
    headers: {
      Authorization: cursorAuthHeader(),
      Accept: "text/event-stream",
    },
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    throw new Error(`Cursor stream failed (${upstream.status}): ${text}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let runFinished = false;

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

  return runFinished;
}
