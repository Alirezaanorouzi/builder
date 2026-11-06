import { Agent, CursorAgentError, type SDKUserMessage } from "@cursor/sdk";
import { getConfig, getCursorModelSelection } from "@/lib/config";
import { streamCloudAgentRun } from "@/services/cursor-cloud-stream";
import type {
  CodingEngineProvider,
  EngineStreamEvent,
  ExecuteRunResult,
  StartRunInput,
} from "../types";

export const cursorEngineProvider: CodingEngineProvider = {
  id: "cursor",

  async executeRun(
    input: StartRunInput,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<ExecuteRunResult> {
    const cfg = getConfig();
    const apiKey = cfg.cursorApiKey;
    const model = getCursorModelSelection();
    const cloud = {
      repos: [{ url: input.tenant.repoUrl, startingRef: input.tenant.repoRef }],
      workOnCurrentBranch: true,
      autoCreatePR: false,
      skipReviewerRequest: true,
    };

    const agent = input.agentId
      ? await Agent.resume(input.agentId, { apiKey, model, cloud })
      : await Agent.create({ apiKey, model, cloud });

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
      const run = await agent.send(
        input.promptImages?.length
          ? ({
              text: input.promptText,
              images: input.promptImages,
            } satisfies SDKUserMessage)
          : input.promptText
      );
      const agentId = agent.agentId;
      const runId = run.id;

      const [finished, result] = await Promise.all([
        streamCloudAgentRun(agentId, runId, forwardStreamEvent),
        run.wait(),
      ]);

      if (result.status === "finished") {
        emitAgentDone("succeeded");
      } else if (result.status === "error") {
        onEvent({
          type: "error",
          message: result.error?.message ?? "Cloud agent run failed",
        });
        emitAgentDone("failed", result.error?.message ?? "Cloud agent run failed");
      } else if (!agentDoneSent && finished) {
        emitAgentDone("succeeded");
      }

      return {
        agentId,
        runId,
        finished: finished || result.status === "finished",
        requestPreview: result.status === "finished",
      };
    } catch (e) {
      if (e instanceof CursorAgentError) {
        throw new Error(`Cursor agent failed: ${e.message}`);
      }
      throw e;
    } finally {
      await agent.close();
    }
  },
};
