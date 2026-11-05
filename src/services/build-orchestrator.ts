import { prisma } from "@/lib/db";
import { getCodingEngine } from "@engines/index";
import { buildAgentUserPrompt } from "@/lib/prompts";
import {
  parseStoredPromptImages,
  storedImagesToSdk,
} from "@/lib/prompt-images";
import {
  publishBuildRunDone,
  publishEngineStreamEvent,
  updateBuildRunStatus,
} from "@/lib/build-runs";
import { publishBuildStream } from "@/lib/build-stream-bus";
import { resolveTenantContext } from "@/lib/site-runtime";
import { setChatSessionEngineAgentId, setSiteCursorAgentId } from "@/lib/sites";
import { waitForDeployment, fetchReadyDeploymentCommitRange } from "@/services/vercel.service";
import { recordProductionCommit, refreshProductionCommitWhenLocked } from "@/services/preview-commit.service";
import { vercelDeployPollOptions } from "@/lib/vercel-deploy-poll";

async function attachPreviewWhenReady(
  buildRunId: string,
  siteId: string,
  tenant: ReturnType<typeof resolveTenantContext>,
  startedAtMs: number,
  commitSha?: string
) {
  try {
    await refreshProductionCommitWhenLocked(siteId);

    const deploy = await waitForDeployment({
      projectId: tenant.vercelProjectId,
      teamId: tenant.vercelTeamId,
      productionUrl: tenant.productionUrl,
      commitSha,
      sinceMs: startedAtMs,
      ...vercelDeployPollOptions(),
    });
    if (deploy.commitSha) {
      await recordProductionCommit(siteId, deploy.commitSha);
    } else if (tenant.vercelProjectId) {
      const range = await fetchReadyDeploymentCommitRange({
        projectId: tenant.vercelProjectId,
        teamId: tenant.vercelTeamId,
      });
      if (range.newest) {
        await recordProductionCommit(siteId, range.newest);
      }
    }
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
    const promptImages = storedImagesToSdk(parseStoredPromptImages(run.promptImages));
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
        promptImages: promptImages.length ? promptImages : undefined,
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
        void attachPreviewWhenReady(
          buildRunId,
          run.site.id,
          tenant,
          startedAtMs,
          result.commitSha
        );
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
