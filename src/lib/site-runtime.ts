import type { Site, SiteResources } from "@prisma/client";
import { getConfig } from "@/lib/config";
import type { TenantContext } from "@engines/types";

export type SiteWithResources = Site & { resources: SiteResources | null };

export function siteHasDedicatedResources(site: SiteWithResources): boolean {
  return Boolean(
    site.resources?.githubRepoFullName && site.resources?.vercelProjectId
  );
}

/** Cursor Cloud Agents operate on GitHub; tenant context maps site resources for the engine. */
export function resolveTenantContext(site: SiteWithResources): TenantContext {
  const cfg = getConfig();
  const r = site.resources;

  if (!r?.githubRepoFullName || !r.vercelProjectId) {
    if (site.status === "active") {
      throw new SiteNotReadyError(
        "Site is active but missing GitHub/Vercel resources. Retry provisioning."
      );
    }
    throw new SiteNotReadyError(
      "Site is not provisioned with dedicated GitHub/Vercel resources."
    );
  }

  return {
    siteId: site.id,
    repoUrl: `https://github.com/${r.githubRepoFullName}`,
    repoRef: r.githubDefaultBranch || cfg.templateRepoRef,
    repoFullName: r.githubRepoFullName,
    vercelProjectId: r.vercelProjectId,
    vercelTeamId: r.vercelTeamId ?? cfg.vercelTeamId,
    productionUrl: r.productionUrl ?? undefined,
    dedicated: true,
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
    if (site.status === "suspended") {
      throw new SiteNotReadyError(
        site.suspendReason ?? "This site is suspended."
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
