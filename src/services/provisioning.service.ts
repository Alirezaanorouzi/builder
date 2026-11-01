import { prisma } from "@/lib/db";
import { getPlatformConfig } from "@/lib/config";
import type { ProvisioningStep } from "@prisma/client";
import { createRepoFromTemplate } from "./github.service";
import { createVercelProjectForRepo } from "./vercel.service";

const provisioningInFlight = new Set<string>();

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

/**
 * Idempotent-ish step runner: resumes from SiteResources.provisioningStep.
 */
export async function runSiteProvisioning(siteId: string): Promise<void> {
  if (provisioningInFlight.has(siteId)) {
    return;
  }
  provisioningInFlight.add(siteId);

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { resources: true },
  });
  if (!site?.resources) {
    provisioningInFlight.delete(siteId);
    throw new Error("Site resources missing");
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { status: "provisioning", updatedAt: new Date() },
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
      await prisma.site.update({
        where: { id: siteId },
        data: { status: "active", updatedAt: new Date() },
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Provisioning failed";
    await prisma.siteResources.update({
      where: { siteId },
      data: { provisioningError: message },
    });
    await prisma.site.update({
      where: { id: siteId },
      data: { status: "failed", updatedAt: new Date() },
    });
    throw e;
  } finally {
    provisioningInFlight.delete(siteId);
  }
}

/** Fire-and-forget wrapper — unified worker picks up `provisioning` sites. */
export function enqueueSiteProvisioning(_siteId: string) {
  /* no-op: run `npm run worker` or INLINE_BUILD_WORKER=1 */
}

/** Claim the next site that still needs GitHub/Vercel setup (single worker). */
export async function processOneProvisioningJob(): Promise<boolean> {
  const site = await prisma.site.findFirst({
    where: {
      status: "provisioning",
      resources: { provisioningStep: { not: "complete" } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!site) return false;
  await runSiteProvisioning(site.id);
  return true;
}
