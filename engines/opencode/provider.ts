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
  createSession,
  healthCheck,
  newOpenCodeMessageId,
  parseOpencodeModel,
  prepareSiteWorkspace,
  promptAsync,
  pushGitChanges,
  watchOpenCodeSession,
} from "./client";

export const opencodeEngineProvider: CodingEngineProvider = {
  id: "opencode",

  async startRun(input: StartRunInput): Promise<StartRunResult> {
    await healthCheck();
    const tenant = input.tenant;
    const dir = tenant.workspaceDirectory;
    const runId = newOpenCodeMessageId();

    if (tenant.dedicated) {
      const bootstrap = await createSession("Workspace bootstrap");
      await prepareSiteWorkspace(bootstrap.id, tenant);
    }

    if (input.agentId) {
      try {
        await promptAsync(input.agentId, input.promptText, runId, dir);
        return { agentId: input.agentId, runId };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        const stale =
          msg.includes("404") ||
          msg.toLowerCase().includes("not found") ||
          msg.toLowerCase().includes("session not found");
        if (!stale) throw e;
      }
    }

    const session = await createSession("Website builder", dir);
    await promptAsync(session.id, input.promptText, runId, dir);
    return { agentId: session.id, runId };
  },

  async streamRun(
    agentId: string,
    _runId: string,
    _startedAt: number,
    tenant: TenantContext,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<EngineStreamResult> {
    const cfg = getConfig();
    const model = parseOpencodeModel(cfg.opencodeModel);
    onEvent({
      type: "status",
      message: `Connected to OpenCode (${model.providerID}/${model.modelID})…`,
    });

    const outcome = await watchOpenCodeSession(
      agentId,
      cfg.opencodeMaxWaitMs,
      (message) => onEvent({ type: "activity", message }),
      (message) => onEvent({ type: "error", message }),
      tenant.workspaceDirectory
    );

    if (outcome === "timeout") {
      onEvent({
        type: "error",
        message:
          "OpenCode timed out. Try a smaller prompt or increase OPENCODE_MAX_WAIT_MS.",
      });
      return { finished: false, requestPreview: false };
    }

    if (outcome === "failed") {
      return { finished: false, requestPreview: false };
    }

    onEvent({ type: "status", message: "Pushing changes to GitHub…" });
    let commitSha: string | undefined;
    try {
      commitSha = await pushGitChanges(agentId, tenant);
    } catch (e) {
      onEvent({
        type: "error",
        message: e instanceof Error ? e.message : "Git push failed",
      });
      return { finished: false, requestPreview: false };
    }

    onEvent({ type: "status", message: "Waiting for Vercel deploy…" });
    onEvent({
      type: "status",
      message:
        "If Vercel shows “Deployment was blocked”, the GitHub repo must be linked to the same Vercel account as the commit author (Hobby + private repo). See README troubleshooting.",
    });
    return { finished: true, requestPreview: true, commitSha };
  },
};

export function assertOpencodeConfig() {
  const c = getConfig();
  if (!c.opencodeServerUrl) throw new Error("Missing OPENCODE_SERVER_URL (CODING_ENGINE=opencode)");
  if (!c.opencodeServerPassword) {
    throw new Error("Missing OPENCODE_SERVER_PASSWORD (CODING_ENGINE=opencode)");
  }
}
