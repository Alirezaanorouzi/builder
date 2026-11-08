import { cursorAgentModelField } from "@/lib/config";
import { streamCloudAgentRun } from "@/services/cursor-cloud-stream";
import {
  cursorPostJson,
  getCursorRun,
  isCursorRunActive,
  parseCursorError,
  type CursorRunInfo,
} from "@/services/cursor.service";
import type {
  CodingEngineProvider,
  EnginePromptImage,
  EngineStreamEvent,
  ExecuteRunResult,
  StartRunInput,
} from "../types";
import { resumeRunByPolling } from "./resume-run";

type PromptPayload =
  | { text: string }
  | {
      text: string;
      images: Array<{
        data: string;
        mimeType: string;
        dimension?: { width: number; height: number };
      }>;
    };

function buildPrompt(promptText: string, promptImages?: EnginePromptImage[]): PromptPayload {
  if (!promptImages?.length) return { text: promptText };
  return {
    text: promptText,
    images: promptImages.map((im) => ({
      data: im.data,
      mimeType: im.mimeType,
      ...(im.dimension ? { dimension: im.dimension } : {}),
    })),
  };
}

/**
 * Create-agent returns `{ agent, run }`. Follow-up `POST …/runs` returns `{ run: { id, agentId } }`
 * or steer `202` with `{ delivery, runId? }` — not a provisioning/DB issue.
 */
async function parseAgentStartResponse(
  res: Response,
  knownAgentId?: string
): Promise<{ agentId: string; runId: string }> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseCursorError(res.status, text));
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Cursor returned invalid JSON (${res.status})`);
  }
  const obj = data as Record<string, unknown>;
  const agentObj = obj.agent as { id?: string; latestRunId?: string } | undefined;
  const runObj = obj.run as { id?: string; agentId?: string } | undefined;

  const runId =
    runObj?.id ??
    (typeof obj.runId === "string" ? obj.runId : undefined) ??
    agentObj?.latestRunId;

  const agentId =
    agentObj?.id ??
    (typeof obj.agentId === "string" ? obj.agentId : undefined) ??
    runObj?.agentId ??
    knownAgentId;

  if (obj.delivery === "queued" && !runId) {
    throw new Error(
      "Cursor queued your follow-up but did not return a run id yet. Wait for the current run to finish, then try again."
    );
  }

  if (!agentId || !runId) {
    throw new Error(
      `Cursor response missing agent or run id (HTTP ${res.status}): ${text.slice(0, 320)}`
    );
  }
  return { agentId, runId };
}

async function waitUntilRunTerminal(agentId: string, runId: string): Promise<CursorRunInfo | null> {
  const pollMs = 2000;
  for (;;) {
    const run = await getCursorRun(agentId, runId);
    if (!run) return null;
    if (!isCursorRunActive(run.status)) return run;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Do not block deploy on a long-lived Cursor SSE after the run is already terminal. */
const STREAM_DRAIN_GRACE_MS = 4_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const cursorRestEngineProvider: CodingEngineProvider = {
  id: "cursor",

  async executeRun(
    input: StartRunInput,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<ExecuteRunResult> {
    const modelField = cursorAgentModelField();
    const prompt = buildPrompt(input.promptText, input.promptImages);

    let res: Response;
    try {
      if (input.agentId) {
        res = await cursorPostJson(`v1/agents/${encodeURIComponent(input.agentId)}/runs`, {
          ...modelField,
          prompt,
        });
      } else {
        res = await cursorPostJson("v1/agents", {
          name: "website-builder",
          ...modelField,
          prompt,
          repos: [{ url: input.tenant.repoUrl, startingRef: input.tenant.repoRef }],
          workOnCurrentBranch: true,
          autoCreatePR: false,
          skipReviewerRequest: true,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cursor request failed";
      throw new Error(`Gateway/Cursor: ${msg}`);
    }

    let agentId: string;
    let runId: string;
    try {
      ({ agentId, runId } = await parseAgentStartResponse(res, input.agentId ?? undefined));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cursor start failed";
      onEvent({ type: "error", message: msg });
      onEvent({
        type: "agent_done",
        status: "failed",
        errorMessage: msg,
        finishedAt: new Date().toISOString(),
      });
      return {
        agentId: input.agentId ?? "",
        runId: "",
        finished: false,
        requestPreview: false,
        errorMessage: msg,
      };
    }

    let agentDoneSent = false;
    const emitAgentDone = (status: "succeeded" | "failed", errorMessage?: string) => {
      if (agentDoneSent) return;
      agentDoneSent = true;
      onEvent({
        type: "agent_done",
        status,
        errorMessage,
        finishedAt: new Date().toISOString(),
      });
    };

    const forwardStreamEvent = (ev: EngineStreamEvent) => {
      if (ev.type === "agent_done") {
        emitAgentDone(ev.status, ev.errorMessage);
        return;
      }
      onEvent(ev);
    };

    try {
      await input.onRunStarted?.({ agentId, runId });
    } catch (e) {
      console.error("[cursor-rest] onRunStarted failed", e);
    }

    const streamPromise = streamCloudAgentRun(agentId, runId, forwardStreamEvent).catch((e) => {
      const msg = e instanceof Error ? e.message : "Stream failed";
      onEvent({ type: "error", message: msg });
      return false;
    });

    const terminal = await waitUntilRunTerminal(agentId, runId);
    await Promise.race([streamPromise, sleep(STREAM_DRAIN_GRACE_MS)]);

    if (terminal?.status === "FINISHED") {
      if (!agentDoneSent) emitAgentDone("succeeded");
      return { agentId, runId, finished: true, requestPreview: true };
    }

    const errMsg = terminal
      ? `Agent run ended as ${terminal.status.toLowerCase()}`
      : "Cursor no longer has this agent run.";
    onEvent({ type: "error", message: errMsg });
    if (!agentDoneSent) emitAgentDone("failed", errMsg);

    return {
      agentId,
      runId,
      finished: false,
      requestPreview: false,
      errorMessage: errMsg,
    };
  },

  async resumeRun(input, onEvent) {
    return resumeRunByPolling(input, onEvent);
  },
};
