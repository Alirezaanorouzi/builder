import { prisma } from "@/lib/db";
import { getPlatformConfig } from "@/lib/config";
import type { ProvisioningStep } from "@prisma/client";
import { transitionSiteStatus } from "@/services/site-status.service";
import { createRepoFromTemplate } from "./github.service";
import { createVercelProjectForRepo } from "./vercel.service";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function repoNameForSite(slug: string, siteId: string): string {
  const suffix = siteId.replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  const base = `builder-${slug}-${suffix}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return base.slice(0, 90);
}

async function setStep(
  siteId: string,
  step: ProvisioningStep,
  patch?: { provisioningError?: string | null }
) {
  await prisma.siteResources.update({
    where: { siteId },
    data: { provisioningStep: step, provisioningError: patch?.provisioningError ?? null },
  });
}

async function releaseProvisioningLease(siteId: string) {
  await prisma.siteResources.update({
    where: { siteId },
    data: {
      provisioningLeaseUntil: null,
      provisioningWorkerId: null,
      updatedAt: new Date(),
    },
  });
}

/** Postgres: claim next site needing provisioning (multi-worker safe). */
export async function claimNextProvisioningSite(
  workerId: string,
  leaseMinutes: number
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ siteId: string }[]>`
    UPDATE "SiteResources"
    SET
      "provisioningLeaseUntil" = NOW() + make_interval(mins => ${leaseMinutes}),
      "provisioningWorkerId" = ${workerId},
      "provisioningAttempts" = "provisioningAttempts" + 1,
      "updatedAt" = NOW()
    WHERE "siteId" = (
      SELECT r."siteId"
      FROM "SiteResources" r
      INNER JOIN "Site" s ON s.id = r."siteId"
      WHERE s.status = 'provisioning'::"SiteStatus"
        AND r."provisioningStep" <> 'complete'::"ProvisioningStep"
        AND (
          r."provisioningLeaseUntil" IS NULL
          OR r."provisioningLeaseUntil" < NOW()
        )
      ORDER BY s."createdAt" ASC
      FOR UPDATE OF r SKIP LOCKED
      LIMIT 1
    )
    RETURNING "siteId"
  `;
  return rows[0]?.siteId ?? null;
}

/**
 * Idempotent step runner: resumes from SiteResources.provisioningStep.
 * Caller must hold the DB lease (see claimNextProvisioningSite).
 */
export async function runSiteProvisioning(siteId: string): Promise<void> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { resources: true },
  });
  if (!site?.resources) {
    throw new Error("Site resources missing");
  }

  await transitionSiteStatus(siteId, "provisioning", {
    message: "Provisioning started or resumed",
  });

  await prisma.siteResources.update({
    where: { siteId },
    data: { provisioningError: null },
  });

  const platform = getPlatformConfig();
  let step = site.resources.provisioningStep;
  let githubFullName = site.resources.githubRepoFullName;
  let githubRepoId = site.resources.githubRepoId;
  let branch = site.resources.githubDefaultBranch;
  const repoName = repoNameForSite(site.slug, site.id);

  try {
    if (
      step === "pending_github_repo" ||
      (!githubFullName && step !== "complete")
    ) {
      const repo = await createRepoFromTemplate({
        repoName,
        description: `${site.displayName} (Website Builder)`,
      });
      githubFullName = repo.fullName;
      githubRepoId = String(repo.id);
      branch = repo.defaultBranch;
      await prisma.siteResources.update({
        where: { siteId },
        data: {
          githubRepoFullName: githubFullName,
          githubRepoId,
          githubDefaultBranch: branch,
          provisioningStep: "github_repo_created",
          provisioningError: null,
        },
      });
      step = "github_repo_created";
    }

    if (githubFullName) {
      const resourcesNow = await prisma.siteResources.findUnique({ where: { siteId } });
      if (!resourcesNow?.vercelProjectId) {
        await setStep(siteId, "pending_vercel_project");
        await sleep(2500);
      }
      const project = await createVercelProjectForRepo({
        projectName: repoName,
        githubRepoFullName: githubFullName,
      });
      await prisma.siteResources.update({
        where: { siteId },
        data: {
          vercelProjectId: project.id,
          vercelTeamId: platform.vercelTeamId ?? null,
          productionUrl: project.productionUrl,
          provisioningStep: "pending_initial_deploy",
          provisioningError: null,
        },
      });

      await setStep(siteId, "pending_initial_deploy");
      try {
        const { waitForDeployment } = await import("@/services/vercel.service");
        await waitForDeployment({
          projectId: project.id,
          teamId: platform.vercelTeamId,
          productionUrl: project.productionUrl ?? undefined,
          maxAttempts: 18,
          delayMs: 10_000,
        });
      } catch {
        /* initial deploy may still be building — site can still become active */
      }
      await setStep(siteId, "complete");
      await transitionSiteStatus(siteId, "active", {
        message: "GitHub + Vercel provisioning complete",
        setActivatedAt: true,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Provisioning failed";
    await prisma.siteResources.update({
      where: { siteId },
      data: { provisioningError: message },
    });
    await transitionSiteStatus(siteId, "failed", { message });
    throw e;
  } finally {
    await releaseProvisioningLease(siteId);
  }
}

/** Worker picks up sites in `provisioning` status. */
export function enqueueSiteProvisioning(_siteId: string) {
  /* no-op: run worker with WORKER_MODE=all|provisioning */
}

export async function processOneProvisioningJob(
  workerId: string,
  leaseMinutes: number
): Promise<boolean> {
  const siteId = await claimNextProvisioningSite(workerId, leaseMinutes);
  if (!siteId) return false;
  await runSiteProvisioning(siteId);
  return true;
}
