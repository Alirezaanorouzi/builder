import { prisma } from "@/lib/db";
import { getPlatformConfig } from "@/lib/platform-config";
import type { ProvisioningStep } from "@prisma/client";
import { createRepoFromTemplate } from "./github";
import { createVercelProjectForRepo } from "./vercel-project";

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
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { resources: true },
  });
  if (!site?.resources) {
    throw new Error("Site resources missing");
  }

  await prisma.site.update({
    where: { id: siteId },
    data: { status: "provisioning", updatedAt: new Date() },
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

    if (
      step === "github_repo_created" ||
      step === "pending_vercel_project" ||
      (githubFullName && !site.resources.vercelProjectId)
    ) {
      const resourcesNow = await prisma.siteResources.findUnique({ where: { siteId } });
      if (resourcesNow?.vercelProjectId) {
        step = "vercel_project_created";
      } else {
      await setStep(siteId, "pending_vercel_project");
      const project = await createVercelProjectForRepo({
        projectName: repoName,
        githubRepoFullName: githubFullName!,
      });
      await prisma.siteResources.update({
        where: { siteId },
        data: {
          vercelProjectId: project.id,
          vercelTeamId: platform.vercelTeamId ?? null,
          productionUrl: project.productionUrl,
          provisioningStep: "vercel_project_created",
          provisioningError: null,
        },
      });
      step = "vercel_project_created";
      }
    }

    if (step === "vercel_project_created" || step === "pending_initial_deploy") {
      await setStep(siteId, "pending_initial_deploy");
      const resources = await prisma.siteResources.findUnique({ where: { siteId } });
      if (resources?.vercelProjectId) {
        try {
          const { waitForDeployment } = await import("@/lib/vercel");
          await waitForDeployment({
            projectId: resources.vercelProjectId,
            teamId: resources.vercelTeamId ?? platform.vercelTeamId,
            productionUrl: resources.productionUrl ?? undefined,
            maxAttempts: 18,
            delayMs: 10_000,
          });
        } catch {
          /* initial deploy may still be building — site can still become active */
        }
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
  }
}

/** Fire-and-forget wrapper for API routes. */
export function enqueueSiteProvisioning(siteId: string) {
  void runSiteProvisioning(siteId).catch((e) => {
    console.error("[provisioning]", siteId, e);
  });
}
