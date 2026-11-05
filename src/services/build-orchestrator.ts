import { prisma } from "@/lib/db";
import { getCodingEngine } from "@engines/index";
import { buildAgentUserPrompt } from "@/lib/prompts";
import {
  publishBuildRunDone,
  publishEngineStreamEvent,
  updateBuildRunStatus,
} from "@/lib/build-runs";
import { publishBuildStream } from "@/lib/build-stream-bus";
import { resolveTenantContext } from "@/lib/site-runtime";
import { setChatSessionEngineAgentId, setSiteCursorAgentId } from "@/lib/sites";
import { waitForDeployment } from "@/services/vercel.service";
import { vercelDeployPollOptions } from "@/lib/vercel-deploy-poll";

async function attachPreviewWhenReady(
  buildRunId: string,
  tenant: ReturnType<typeof resolveTenantContext>,
  startedAtMs: number,
  commitSha?: string
) {
  try {
    const deploy = await waitForDeployment({
      projectId: tenant.vercelProjectId,
      teamId: tenant.vercelTeamId,
      productionUrl: tenant.productionUrl,
      commitSha,
      sinceMs: startedAtMs,
      ...vercelDeployPollOptions(),
    });
    if (deploy.url) {
      await updateBuildRunStatus(buildRunId, "succeeded", {
        commitSha: deploy.commitSha ?? commitSha,
        deploymentId: deploy.deploymentId,
        deployUrl: deploy.url,
        finishedAt: new Date(),
      });
    }
  } catch (e) {
    console.error("[build] preview poll failed", buildRunId, e);
  }
}

export async function executeBuildRun(buildRunId: string): Promise<void> {
  const run = await prisma.buildRun.findUnique({
    where: { id: buildRunId },
    include: {
      site: { include: { resources: true } },
      chatSession: true,
    },
  });
  if (!run) return;

  let terminalStatus: Awaited<ReturnType<typeof updateBuildRunStatus>> | null = null;

  try {
    const tenant = resolveTenantContext(run.site);
    const engine = getCodingEngine();
    const promptText = buildAgentUserPrompt(run.userMessage);

    await updateBuildRunStatus(buildRunId, "running", {
      startedAt: run.startedAt ?? new Date(),
    });

    const existingAgentId =
      run.site.resources?.cursorAgentId ?? run.chatSession.engineAgentId;

    const startedAtMs = run.startedAt?.getTime() ?? Date.now();

    const result = await engine.executeRun(
      {
        promptText,
        agentId: existingAgentId,
        tenant,
      },
      (ev) => {
        publishEngineStreamEvent(buildRunId, ev);
      }
    );

    if (run.site.resources?.cursorAgentId !== result.agentId) {
      await setSiteCursorAgentId(run.site.id, result.agentId);
    }
    if (run.chatSession.engineAgentId !== result.agentId) {
      await setChatSessionEngineAgentId(run.chatSession.id, result.agentId);
    }

    await updateBuildRunStatus(buildRunId, "running", { engineRunId: result.runId });

    if (result.finished) {
      terminalStatus = await updateBuildRunStatus(buildRunId, "succeeded", {
        deployUrl: tenant.productionUrl,
        finishedAt: new Date(),
      });

      if (result.requestPreview && tenant.vercelProjectId) {
        void attachPreviewWhenReady(buildRunId, tenant, startedAtMs, result.commitSha);
      }
    } else {
      terminalStatus = await updateBuildRunStatus(buildRunId, "failed", {
        errorMessage: "Agent run did not complete successfully",
        finishedAt: new Date(),
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Build failed";
    publishBuildStream(buildRunId, "error", { message });
    try {
      terminalStatus = await updateBuildRunStatus(buildRunId, "failed", {
        errorMessage: message,
        finishedAt: new Date(),
      });
    } catch (persistErr) {
      console.error("[build] failed to persist error state", buildRunId, persistErr);
    }
  } finally {
    if (terminalStatus) {
      publishBuildRunDone(buildRunId, terminalStatus);
    } else {
      const latest = await prisma.buildRun.findUnique({ where: { id: buildRunId } });
      if (latest) publishBuildRunDone(buildRunId, latest);
    }
  }
}
