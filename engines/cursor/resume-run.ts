import type { EngineStreamEvent, ExecuteRunResult, ResumeRunInput } from "../types";
import { getCursorRun, isCursorRunActive } from "@/services/cursor.service";

const RESUME_POLL_MS = 5000;

function resumeMaxWaitMs(): number {
  const raw = Number(process.env.BUILD_RUN_MAX_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 45;
  return minutes * 60 * 1000;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll run status (no SSE replay) — shared by SDK and REST adapters for `resumeRun`.
 */
export async function resumeRunByPolling(
  input: ResumeRunInput,
  onEvent: (event: EngineStreamEvent) => void
): Promise<ExecuteRunResult> {
  const { agentId, runId } = input;
  const startedAt = Date.now();
  const maxWaitMs = resumeMaxWaitMs();
  let consecutiveErrors = 0;

  onEvent({ type: "status", message: "Reconnected to the running agent…" });

  for (;;) {
    let run: Awaited<ReturnType<typeof getCursorRun>>;
    try {
      run = await getCursorRun(agentId, runId);
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) throw e;
      await sleep(RESUME_POLL_MS);
      continue;
    }

    if (!run) {
      const message = "Cursor no longer has this agent run.";
      onEvent({ type: "error", message });
      onEvent({
        type: "agent_done",
        status: "failed",
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      });
      return { agentId, runId, finished: false, requestPreview: false, errorMessage: message };
    }

    if (!isCursorRunActive(run.status)) {
      if (run.status === "FINISHED") {
        onEvent({ type: "agent_done", status: "succeeded", finishedAt: new Date().toISOString() });
        return { agentId, runId, finished: true, requestPreview: true };
      }
      const message = `Agent run ${run.status.toLowerCase()}`;
      onEvent({ type: "error", message });
      onEvent({
        type: "agent_done",
        status: "failed",
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      });
      return { agentId, runId, finished: false, requestPreview: false, errorMessage: message };
    }

    if (Date.now() - startedAt > maxWaitMs) {
      const message = "Agent run did not finish in time after reconnecting.";
      onEvent({ type: "error", message });
      onEvent({
        type: "agent_done",
        status: "failed",
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      });
      return { agentId, runId, finished: false, requestPreview: false, errorMessage: message };
    }

    await input.onHeartbeat?.();
    await sleep(RESUME_POLL_MS);
  }
}
