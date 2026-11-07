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
  startBuildRunHeartbeat,
  touchBuildRun,
  updateBuildRunStatus,
} from "@/lib/build-runs";
import { flushBuildStream, publishBuildStream } from "@/lib/build-stream-bus";
import { isSameCommit } from "@/lib/preview-gate";
import { resolveTenantContext } from "@/lib/site-runtime";
import { setSiteCursorAgentId } from "@/lib/sites";
import { getDefaultBranchHeadSha } from "@/services/github.service";
import { waitForDeployment } from "@/services/vercel.service";
import { recordProductionCommit } from "@/services/preview-commit.service";
import { vercelDeployPollOptions } from "@/lib/vercel-deploy-poll";
import type { TenantContext } from "@engines/types";

type BuildRunRow = NonNullable<Awaited<ReturnType<typeof updateBuildRunStatus>>>;

type RunOutcome = {
  run: BuildRunRow;
  previewChanged: boolean;
};

async function readHeadWithRetry(tenant: TenantContext): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getDefaultBranchHeadSha(tenant.repoFullName, tenant.repoRef);
    } catch (e) {
      console.error("[build] github head lookup failed", attempt + 1, e);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

/**
 * After the agent finished: decide whether a deployment is needed and, if so, wait until
 * Vercel reports it READY. The run only becomes `succeeded` once that is confirmed.
 */
export async function confirmDeploymentForRun(options: {
  buildRunId: string;
  siteId: string;
  tenant: TenantContext;
}): Promise<RunOutcome> {
  const { buildRunId, siteId, tenant } = options;

  await updateBuildRunStatus(buildRunId, "pushing");

  const headAfter = await readHeadWithRetry(tenant);
  if (!headAfter) {
    const message = "Could not read the GitHub branch head to confirm the deployment.";
    publishBuildStream(buildRunId, "error", { message });
    const run = await updateBuildRunStatus(buildRunId, "failed", {
      errorMessage: message,
      finishedAt: new Date(),
    });
    return { run, previewChanged: false };
  }

  const resources = await prisma.siteResources.findUnique({
    where: { siteId },
    select: { productionCommitSha: true },
  });

  // Same commit as the last confirmed READY deployment: nothing new to publish.
  if (isSameCommit(headAfter, resources?.productionCommitSha)) {
    publishBuildStream(buildRunId, "status", { message: "No code changes to publish." });
    const run = await updateBuildRunStatus(buildRunId, "succeeded", {
      commitSha: headAfter,
      deployUrl: tenant.productionUrl,
      finishedAt: new Date(),
    });
    return { run, previewChanged: false };
  }

  await updateBuildRunStatus(buildRunId, "deploying", { commitSha: headAfter });
  publishBuildStream(buildRunId, "phase", {
    runStatus: "deploying",
    message: "Publishing your website…",
  });

  const deploy = await waitForDeployment({
    projectId: tenant.vercelProjectId,
    teamId: tenant.vercelTeamId,
    commitSha: headAfter,
    // The commit SHA identifies the deployment; do not filter by creation time
    // (a previous run's push may still be the one being built).
    sinceMs: 0,
    ...vercelDeployPollOptions(),
    onPoll: () => touchBuildRun(buildRunId),
  });

  if (deploy.status === "ready") {
    await recordProductionCommit(siteId, deploy.commitSha ?? headAfter);
    publishBuildStream(buildRunId, "preview", { url: deploy.url });
    const run = await updateBuildRunStatus(buildRunId, "succeeded", {
      commitSha: deploy.commitSha ?? headAfter,
      deploymentId: deploy.deploymentId,
      deployUrl: deploy.url,
      finishedAt: new Date(),
    });
    return { run, previewChanged: true };
  }

  const message =
    deploy.status === "timeout"
      ? "The deployment did not become ready in time. Check Vercel, then try again."
      : `Deployment failed: ${deploy.note}`;
  publishBuildStream(buildRunId, "error", { message });
  const run = await updateBuildRunStatus(buildRunId, "failed", {
    commitSha: headAfter,
    deploymentId: deploy.status === "error" ? deploy.deploymentId : undefined,
    errorMessage: message,
    finishedAt: new Date(),
  });
  return { run, previewChanged: false };
}

/**
 * Shared run lifecycle: heartbeat while working, persist a failure if `work` throws, and always
 * publish the terminal `done` event (flushed to Postgres) at the end.
 */
async function withRunLifecycle(
  buildRunId: string,
  work: () => Promise<RunOutcome>
): Promise<void> {
  const stopHeartbeat = startBuildRunHeartbeat(buildRunId);
  let terminalStatus: BuildRunRow | null = null;
  let previewChanged = false;

  try {
    const outcome = await work();
    terminalStatus = outcome.run;
    previewChanged = outcome.previewChanged;
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
    stopHeartbeat();
    if (terminalStatus) {
      publishBuildRunDone(buildRunId, terminalStatus, { previewChanged });
    } else {
      const latest = await prisma.buildRun.findUnique({ where: { id: buildRunId } });
      if (latest) publishBuildRunDone(buildRunId, latest, { previewChanged });
    }
    await flushBuildStream(buildRunId);
  }
}

async function failRun(buildRunId: string, errorMessage: string): Promise<RunOutcome> {
  const run = await updateBuildRunStatus(buildRunId, "failed", {
    errorMessage,
    finishedAt: new Date(),
  });
  return { run, previewChanged: false };
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

  await withRunLifecycle(buildRunId, async () => {
    const tenant = resolveTenantContext(run.site);
    const engine = getCodingEngine();
    const promptImages = storedImagesToSdk(parseStoredPromptImages(run.promptImages));
    const promptText = buildAgentUserPrompt(run.userMessage);

    await updateBuildRunStatus(buildRunId, "running", {
      startedAt: run.startedAt ?? new Date(),
    });

    // `SiteResources.cursorAgentId` is the source of truth; ChatSession.engineAgentId is only
    // read as a fallback for sessions created before the id moved.
    const existingAgentId =
      run.site.resources?.cursorAgentId ?? run.chatSession.engineAgentId;

    const result = await engine.executeRun(
      {
        promptText,
        promptImages: promptImages.length ? promptImages : undefined,
        agentId: existingAgentId,
        tenant,
        // Persist ids the moment the run exists remotely, so a restart can re-attach.
        onRunStarted: async ({ agentId, runId }) => {
          await updateBuildRunStatus(buildRunId, "running", { engineRunId: runId });
          if (run.site.resources?.cursorAgentId !== agentId) {
            await setSiteCursorAgentId(run.site.id, agentId);
          }
        },
      },
      (ev) => {
        publishEngineStreamEvent(buildRunId, ev);
      }
    );

    if (!result.finished) {
      return failRun(buildRunId, result.errorMessage ?? "Agent run did not complete successfully");
    }

    return confirmDeploymentForRun({ buildRunId, siteId: run.site.id, tenant });
  });
}

/**
 * Take over a run whose worker died after the Cursor agent run started: wait for the remote run
 * to end (or skip straight to deployment confirmation if the agent already finished), then
 * finish exactly like a normal run. The caller must have claimed the run first.
 */
export async function recoverBuildRun(buildRunId: string): Promise<void> {
  const run = await prisma.buildRun.findUnique({
    where: { id: buildRunId },
    include: { site: { include: { resources: true } } },
  });
  if (!run) return;

  await withRunLifecycle(buildRunId, async () => {
    const tenant = resolveTenantContext(run.site);
    const agentId = run.site.resources?.cursorAgentId;
    const runId = run.engineRunId;

    publishBuildStream(buildRunId, "status", {
      message: "The worker restarted; resuming where the agent left off…",
    });

    // The agent was already done; only the publish step was interrupted.
    if (run.status === "pushing" || run.status === "deploying") {
      return confirmDeploymentForRun({ buildRunId, siteId: run.site.id, tenant });
    }

    if (!agentId || !runId) {
      return failRun(buildRunId, "Cannot recover: the agent run id was not saved.");
    }

    const result = await getCodingEngine().resumeRun(
      { agentId, runId, onHeartbeat: () => touchBuildRun(buildRunId) },
      (ev) => {
        publishEngineStreamEvent(buildRunId, ev);
      }
    );

    if (!result.finished) {
      return failRun(buildRunId, result.errorMessage ?? "Agent run did not complete successfully");
    }

    return confirmDeploymentForRun({ buildRunId, siteId: run.site.id, tenant });
  });
}
