import { prisma } from "@/lib/db";
import { getCodingEngine } from "@engines/index";
import { wrapUserPrompt } from "@/lib/prompts";
import {
  appendBuildEvent,
  engineEventToBuildEventType,
  updateBuildRunStatus,
} from "@/lib/build-runs";
import { resolveTenantContext } from "@/lib/site-runtime";
import type { TenantContext } from "@engines/types";
import { setChatSessionEngineAgentId, setSiteCursorAgentId } from "@/lib/sites";
import { waitForDeployment } from "@/services/vercel.service";

export async function executeBuildRun(buildRunId: string): Promise<void> {
  const run = await prisma.buildRun.findUnique({
    where: { id: buildRunId },
    include: {
      site: { include: { resources: true } },
      chatSession: true,
    },
  });
  if (!run) return;

  let tenant: TenantContext | undefined;

  try {
    tenant = resolveTenantContext(run.site);

    await updateBuildRunStatus(buildRunId, "preparing_workspace", {
      startedAt: run.startedAt ?? new Date(),
    });
    await appendBuildEvent(buildRunId, "status", {
      message: "Preparing workspace…",
    });

    const engine = getCodingEngine();
    const promptText = wrapUserPrompt(run.userMessage);

    await updateBuildRunStatus(buildRunId, "running");
    await appendBuildEvent(buildRunId, "status", {
      message: `Starting ${engine.id} agent…`,
    });

    const existingAgentId =
      run.site.resources?.cursorAgentId ?? run.chatSession.engineAgentId;

    const { agentId, runId: engineRunId } = await engine.startRun({
      promptText,
      agentId: existingAgentId,
      tenant,
    });

    if (run.site.resources?.cursorAgentId !== agentId) {
      await setSiteCursorAgentId(run.site.id, agentId);
    }
    if (run.chatSession.engineAgentId !== agentId) {
      await setChatSessionEngineAgentId(run.chatSession.id, agentId);
    }

    await updateBuildRunStatus(buildRunId, "running", { engineRunId });

    const startedAt = run.startedAt?.getTime() ?? Date.now();

    const result = await engine.streamRun(
      agentId,
      engineRunId,
      startedAt,
      tenant,
      async (ev) => {
        const mapped = engineEventToBuildEventType(ev);
        await appendBuildEvent(buildRunId, mapped.eventType, {
          message: mapped.message,
          payload: mapped.payload,
        });
      }
    );

    const commitSha = result.commitSha;

    if (result.requestPreview) {
      await updateBuildRunStatus(buildRunId, "pushing");
      if (commitSha) {
        await appendBuildEvent(buildRunId, "status", {
          message: `Pushed commit ${commitSha.slice(0, 7)}…`,
        });
      }

      await updateBuildRunStatus(buildRunId, "deploying");
      await appendBuildEvent(buildRunId, "status", {
        message: "Waiting for Vercel deployment…",
      });

      const deploy = await waitForDeployment({
        projectId: tenant.vercelProjectId,
        teamId: tenant.vercelTeamId,
        productionUrl: tenant.productionUrl,
        commitSha,
        sinceMs: startedAt,
      });

      if (deploy.note) {
        await appendBuildEvent(buildRunId, "status", { message: deploy.note });
      }

      if (deploy.url) {
        await appendBuildEvent(buildRunId, "preview", {
          payload: { url: deploy.url },
        });
        await updateBuildRunStatus(buildRunId, "succeeded", {
          commitSha: deploy.commitSha ?? commitSha,
          deploymentId: deploy.deploymentId,
          deployUrl: deploy.url,
          finishedAt: new Date(),
        });
      } else {
        await appendBuildEvent(buildRunId, "status", {
          message: "Build finished but no deployment URL yet. Check Vercel dashboard.",
        });
        await updateBuildRunStatus(buildRunId, "succeeded", {
          commitSha,
          finishedAt: new Date(),
        });
      }
    } else if (result.finished) {
      await updateBuildRunStatus(buildRunId, "succeeded", {
        commitSha,
        finishedAt: new Date(),
      });
    } else {
      await updateBuildRunStatus(buildRunId, "failed", {
        errorMessage: "Agent run did not complete successfully",
        finishedAt: new Date(),
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Build failed";
    await appendBuildEvent(buildRunId, "error", { message });
    await updateBuildRunStatus(buildRunId, "failed", {
      errorMessage: message,
      finishedAt: new Date(),
    });
  } finally {
    await appendBuildEvent(buildRunId, "done", {});
  }
}
