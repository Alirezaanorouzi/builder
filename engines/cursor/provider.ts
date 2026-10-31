import { getConfig } from "@/lib/config";
import type {
  CodingEngineProvider,
  EngineStreamEvent,
  EngineStreamResult,
  StartRunInput,
  StartRunResult,
  TenantContext,
} from "../types";
import {
  createAgentWithRun,
  cursorAuthHeader,
  cursorStreamUrl,
  friendlyToolActivity,
  sendFollowUpRun,
} from "./client";

async function consumeCursorSse(
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
        const friendly = friendlyToolActivity(name, status);
        if (friendly) onEvent({ type: "activity", message: friendly });
        continue;
      }

      if (eventType === "result") {
        const status = String(payload.status ?? "");
        if (status === "FINISHED") {
          runFinished = true;
          onEvent({ type: "status", message: "Code updated. Waiting for Vercel deploy…" });
        } else {
          onEvent({ type: "status", message: `Run ended: ${status}` });
        }
      }
    }
  }

  return runFinished;
}

export const cursorEngineProvider: CodingEngineProvider = {
  id: "cursor",

  async startRun(input: StartRunInput): Promise<StartRunResult> {
    if (!input.agentId) {
      return createAgentWithRun(input.promptText, input.tenant);
    }
    const { runId } = await sendFollowUpRun(input.agentId, input.promptText);
    return { agentId: input.agentId, runId };
  },

  async streamRun(
    agentId: string,
    runId: string,
    _startedAt: number,
    _tenant: TenantContext,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<EngineStreamResult> {
    onEvent({ type: "status", message: "Connected to Cursor build agent…" });
    try {
      const finished = await consumeCursorSse(agentId, runId, onEvent);
      return { finished, requestPreview: finished };
    } catch (e) {
      onEvent({
        type: "error",
        message: e instanceof Error ? e.message : "Cursor stream error",
      });
      return { finished: false, requestPreview: false };
    }
  },
};

export function assertCursorConfig() {
  const c = getConfig();
  if (!c.cursorApiKey) {
    throw new Error("Missing CURSOR_API_KEY (CODING_ENGINE=cursor)");
  }
}
