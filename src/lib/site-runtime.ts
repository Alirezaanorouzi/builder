import type { Site, SiteResources } from "@prisma/client";
import { getConfig } from "@/lib/config";
import type { TenantContext } from "@engines/types";

export type SiteWithResources = Site & { resources: SiteResources | null };

export function siteHasDedicatedResources(site: SiteWithResources): boolean {
  return Boolean(
    site.resources?.githubRepoFullName && site.resources?.vercelProjectId
  );
}

export function workspaceDirectoryForBuild(siteId: string, buildRunId: string): string {
  return `/workspaces/${siteId}/${buildRunId}`;
}

/** Per-site / per-build tenant for engines. Active sites require dedicated SiteResources. */
export function resolveTenantContext(
  site: SiteWithResources,
  buildRunId?: string
): TenantContext {
  const cfg = getConfig();
  const r = site.resources;

  if (r?.githubRepoFullName && r.vercelProjectId) {
    const workspaceDirectory = buildRunId
      ? workspaceDirectoryForBuild(site.id, buildRunId)
      : `/workspaces/${site.id}`;
    return {
      siteId: site.id,
      repoUrl: `https://github.com/${r.githubRepoFullName}`,
      repoRef: r.githubDefaultBranch || cfg.templateRepoRef,
      repoFullName: r.githubRepoFullName,
      vercelProjectId: r.vercelProjectId,
      vercelTeamId: r.vercelTeamId ?? cfg.vercelTeamId,
      productionUrl: r.productionUrl ?? undefined,
      workspaceDirectory,
      dedicated: true,
    };
  }

  if (site.status === "active") {
    throw new SiteNotReadyError(
      "Site is active but missing GitHub/Vercel resources. Retry provisioning."
    );
  }

  const allowLegacy = process.env.ALLOW_SHARED_MVP_FALLBACK === "1";
  if (!allowLegacy) {
    throw new SiteNotReadyError(
      "Site is not provisioned with dedicated GitHub/Vercel resources."
    );
  }

  return {
    siteId: site.id,
    repoUrl: cfg.templateRepoUrl,
    repoRef: cfg.templateRepoRef,
    repoFullName: cfg.templateRepoUrl.replace(/^https:\/\/github.com\//, "").replace(/\.git$/, ""),
    vercelProjectId: cfg.vercelProjectId,
    vercelTeamId: cfg.vercelTeamId,
    productionUrl: cfg.vercelProductionUrl,
    workspaceDirectory: buildRunId
      ? workspaceDirectoryForBuild(site.id, buildRunId)
      : "/workspace",
    dedicated: false,
  };
}

export function assertSiteReadyForBuild(site: SiteWithResources) {
  if (site.status !== "active") {
    if (site.status === "provisioning") {
      throw new SiteNotReadyError("Site is still provisioning. Wait a moment and try again.");
    }
    if (site.status === "failed") {
      throw new SiteNotReadyError(
        site.resources?.provisioningError ??
          "Site provisioning failed. Retry from Sites or POST /api/sites/:id/provision."
      );
    }
    throw new SiteNotReadyError(`Site is not active (status: ${site.status}).`);
  }
}

export class SiteNotReadyError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "SiteNotReadyError";
  }
}
