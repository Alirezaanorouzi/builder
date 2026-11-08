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
import { MAX_DEPLOY_CONFIRM_RECOVERIES, vercelDeployPollOptions } from "@/lib/vercel-deploy-poll";
import {
  DEFERRED_DEPLOY_CONFIRMATION,
  DEPLOY_NOT_READY_IN_TIME,
  GENERIC_BUILD_FAILED,
  RESUME_DEPLOY_CONFIRMATION,
  VERCEL_DEPLOY_AUTH_ISSUE,
  VERCEL_BUILD_FAILED,
} from "@/lib/build-user-messages";
import type { DeploymentResult } from "@/services/vercel.service";
import type { TenantContext } from "@engines/types";
type BuildRunRow = NonNullable<Awaited<ReturnType<typeof updateBuildRunStatus>>>;

type RunOutcome = {
  run: BuildRunRow;
  previewChanged: boolean;
  /** Agent finished; deploy confirmation resumes via stale-run recovery. */
  deferConfirmation?: boolean;
};

function isRetryableDeployOutcome(deploy: DeploymentResult): boolean {
  if (deploy.status === "timeout") return deploy.retryable !== false;
  if (deploy.status === "unavailable") return deploy.retryable === true;
  return false;
}

async function countDeferredDeployConfirmations(buildRunId: string): Promise<number> {
  return prisma.buildEvent.count({
    where: {
      buildRunId,
      eventType: "status",
      message: DEFERRED_DEPLOY_CONFIRMATION,
    },
  });
}

async function deferDeployConfirmation(buildRunId: string): Promise<RunOutcome> {
  const priorDefers = await countDeferredDeployConfirmations(buildRunId);
  if (priorDefers >= MAX_DEPLOY_CONFIRM_RECOVERIES) {
    publishBuildStream(buildRunId, "error", { message: DEPLOY_NOT_READY_IN_TIME });
    const run = await updateBuildRunStatus(buildRunId, "failed", {
      errorMessage: DEPLOY_NOT_READY_IN_TIME,
      finishedAt: new Date(),
    });
    return { run, previewChanged: false };
  }
  publishBuildStream(buildRunId, "status", { message: DEFERRED_DEPLOY_CONFIRMATION });
  await touchBuildRun(buildRunId);
  const run = await prisma.buildRun.findUnique({ where: { id: buildRunId } });
  if (!run) throw new Error(`Build run ${buildRunId} missing after defer`);
  return { run, previewChanged: false, deferConfirmation: true };
}

async function readHeadWithRetry(tenant: TenantContext): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await getDefaultBranchHeadSha(tenant.repoFullName, tenant.repoRef);
    } catch (e) {
      console.error("[build] github head lookup failed", attempt + 1, e);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
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
    console.warn("[build] github head unavailable after agent; deferring confirmation", buildRunId);
    return deferDeployConfirmation(buildRunId);
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

  const deployPoll = {
    projectId: tenant.vercelProjectId,
    teamId: tenant.vercelTeamId,
    commitSha: headAfter,
    sinceMs: 0,
    ...vercelDeployPollOptions(),
    onPoll: () => touchBuildRun(buildRunId),
  } as const;

  const CONFIRM_ROUNDS = 3;
  let deploy: DeploymentResult = {
    status: "timeout",
    note: "deploy_poll_not_started",
    retryable: true,
  };

  for (let round = 0; round < CONFIRM_ROUNDS; round++) {
    if (round > 0) {
      console.info("[build] retrying Vercel deploy confirmation", buildRunId, round);
      publishBuildStream(buildRunId, "status", {
        message: "هنوز در حال بررسی انتشار پیش‌نمایش…",
      });
      await touchBuildRun(buildRunId);
      await new Promise((r) => setTimeout(r, 6_000 * round));
    }
    deploy = await waitForDeployment({
      ...deployPoll,
      onPoll: () => touchBuildRun(buildRunId),
    });
    if (deploy.status === "ready") break;
    if (!isRetryableDeployOutcome(deploy)) break;
  }

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

  if (isRetryableDeployOutcome(deploy)) {
    console.warn("[build] deploy confirmation inconclusive; deferring", buildRunId, deploy.status, deploy.note);
    return deferDeployConfirmation(buildRunId);
  }

  if (deploy.status === "unavailable" && deploy.retryable === false) {
    console.error("[build] vercel auth/config", buildRunId, deploy.note);
    publishBuildStream(buildRunId, "error", { message: VERCEL_DEPLOY_AUTH_ISSUE });
    const run = await updateBuildRunStatus(buildRunId, "failed", {
      commitSha: headAfter,
      errorMessage: VERCEL_DEPLOY_AUTH_ISSUE,
      finishedAt: new Date(),
    });
    return { run, previewChanged: false };
  }

  const userMessage = deploy.status === "error" ? VERCEL_BUILD_FAILED : DEPLOY_NOT_READY_IN_TIME;
  console.error("[build] vercel deploy terminal failure", buildRunId, deploy);
  publishBuildStream(buildRunId, "error", { message: userMessage });
  const run = await updateBuildRunStatus(buildRunId, "failed", {
    commitSha: headAfter,
    deploymentId: deploy.status === "error" ? deploy.deploymentId : undefined,
    errorMessage: userMessage,
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
  let skipTerminalDone = false;

  try {
    const outcome = await work();
    if (outcome.deferConfirmation) {
      skipTerminalDone = true;
    } else {
      terminalStatus = outcome.run;
      previewChanged = outcome.previewChanged;
    }
  } catch (e) {
    console.error("[build] unhandled run error", buildRunId, e);
    const current = await prisma.buildRun.findUnique({
      where: { id: buildRunId },
      select: { status: true },
    });
    if (current?.status === "pushing" || current?.status === "deploying") {
      const defers = await countDeferredDeployConfirmations(buildRunId);
      if (defers >= MAX_DEPLOY_CONFIRM_RECOVERIES) {
        publishBuildStream(buildRunId, "error", { message: DEPLOY_NOT_READY_IN_TIME });
        terminalStatus = await updateBuildRunStatus(buildRunId, "failed", {
          errorMessage: DEPLOY_NOT_READY_IN_TIME,
          finishedAt: new Date(),
        });
      } else {
        publishBuildStream(buildRunId, "status", { message: DEFERRED_DEPLOY_CONFIRMATION });
        await touchBuildRun(buildRunId);
        skipTerminalDone = true;
      }
    } else {
      publishBuildStream(buildRunId, "error", { message: GENERIC_BUILD_FAILED });
      try {
        terminalStatus = await updateBuildRunStatus(buildRunId, "failed", {
          errorMessage: GENERIC_BUILD_FAILED,
          finishedAt: new Date(),
        });
      } catch (persistErr) {
        console.error("[build] failed to persist error state", buildRunId, persistErr);
      }
    }
  } finally {
    stopHeartbeat();
    if (!skipTerminalDone) {
      if (terminalStatus) {
        publishBuildRunDone(buildRunId, terminalStatus, { previewChanged });
      } else {
        const latest = await prisma.buildRun.findUnique({ where: { id: buildRunId } });
        if (latest) publishBuildRunDone(buildRunId, latest, { previewChanged });
      }
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

    publishBuildStream(buildRunId, "status", {
      message: "کد آماده شد؛ در حال انتشار در پیش‌نمایش…",
    });

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

    if (run.status === "pushing" || run.status === "deploying") {
      const defers = await countDeferredDeployConfirmations(buildRunId);
      if (defers >= MAX_DEPLOY_CONFIRM_RECOVERIES) {
        return failRun(buildRunId, DEPLOY_NOT_READY_IN_TIME);
      }
      publishBuildStream(buildRunId, "status", { message: RESUME_DEPLOY_CONFIRMATION });
      return confirmDeploymentForRun({ buildRunId, siteId: run.site.id, tenant });
    }

    publishBuildStream(buildRunId, "status", {
      message: "The worker restarted; resuming where the agent left off…",
    });

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
