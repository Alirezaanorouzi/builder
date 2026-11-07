import { getCodingEngineId } from "@/lib/config";
import { prisma } from "@/lib/db";
import { transitionSiteStatus } from "@/services/site-status.service";
import {
  siteHasDedicatedResources,
  type SiteWithResources,
} from "@/lib/site-runtime";
import type { CodingEngine } from "@prisma/client";
import { clientProductionUrl, isPreviewUnlocked } from "@/lib/preview-gate";

const DEFAULT_SITE_SLUG = "default";

export function serializeSiteForClient(site: SiteWithResources) {
  const resources = site.resources;
  return {
    id: site.id,
    slug: site.slug,
    displayName: site.displayName,
    status: site.status,
    statusChangedAt: site.statusChangedAt.toISOString(),
    activatedAt: site.activatedAt?.toISOString() ?? null,
    suspendReason: site.suspendReason ?? null,
    provisioningStep: resources?.provisioningStep ?? null,
    provisioningError: resources?.provisioningError ?? null,
    provisioningAttempts: resources?.provisioningAttempts ?? 0,
    productionUrl: clientProductionUrl(resources),
    previewAvailable: isPreviewUnlocked(resources),
    githubRepoFullName: resources?.githubRepoFullName ?? null,
  };
}

/** Start or resume GitHub + Vercel provisioning when the site has no dedicated resources yet. */
export async function syncSiteProvisioning(site: SiteWithResources): Promise<void> {
  const hasDedicated = siteHasDedicatedResources(site);

  // Race: provisioning marked failed after GitHub + Vercel were saved — unblock the user.
  if (site.status === "failed" && hasDedicated) {
    await transitionSiteStatus(site.id, "active", {
      message: "Recovered: resources present after failed provisioning",
      setActivatedAt: true,
    });
    await prisma.siteResources.update({
      where: { siteId: site.id },
      data: {
        provisioningStep: "complete",
        provisioningError: null,
      },
    });
    return;
  }

  if (hasDedicated && site.status === "active") {
    return;
  }

  let status = site.status;
  if (status === "active" && !site.resources?.githubRepoFullName) {
    await transitionSiteStatus(site.id, "provisioning", {
      message: "Missing resources; re-provisioning",
    });
    status = "provisioning";
  }

  if (status === "provisioning" || status === "failed") {
    /* worker claims via DB lease */
  }
}

export async function ensureDefaultSite(userId: string) {
  const existing = await prisma.site.findFirst({
    where: { userId, slug: DEFAULT_SITE_SLUG },
    include: { resources: true },
  });
  if (existing) {
    await syncSiteProvisioning(existing);
    return prisma.site.findFirstOrThrow({
      where: { id: existing.id },
      include: { resources: true },
    });
  }

  const created = await prisma.site.create({
    data: {
      userId,
      slug: DEFAULT_SITE_SLUG,
      displayName: "My website",
      status: "provisioning",
      resources: {
        create: {},
      },
    },
    include: { resources: true },
  });
  await transitionSiteStatus(created.id, "provisioning", { message: "Default site created" });
  return created;
}

export async function createUserSite(userId: string, displayName: string, slug?: string) {
  const baseSlug =
    slug?.trim() ||
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) ||
    "site";

  let finalSlug = baseSlug;
  for (let i = 0; i < 5; i++) {
    const taken = await prisma.site.findFirst({
      where: { userId, slug: finalSlug },
    });
    if (!taken) break;
    finalSlug = `${baseSlug}-${i + 2}`;
  }

  const site = await prisma.site.create({
    data: {
      userId,
      slug: finalSlug,
      displayName: displayName.trim() || "My website",
      status: "provisioning",
      resources: { create: {} },
    },
    include: { resources: true },
  });
  await transitionSiteStatus(site.id, "provisioning", { message: "Site created" });
  return site;
}

export async function listSitesForUser(userId: string) {
  return prisma.site.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { resources: true },
  });
}

export async function getOrCreateChatSession(siteId: string, chatSessionId?: string | null) {
  if (chatSessionId) {
    const existing = await prisma.chatSession.findFirst({
      where: { id: chatSessionId, siteId },
    });
    if (existing) return existing;
  }

  const engine = getCodingEngineId() as CodingEngine;
  return prisma.chatSession.create({
    data: { siteId, engine },
  });
}

export async function setSiteCursorAgentId(
  siteId: string,
  cursorAgentId: string,
  cursorAgentStatus?: string
) {
  return prisma.siteResources.update({
    where: { siteId },
    data: {
      cursorAgentId,
      cursorAgentStatus: cursorAgentStatus ?? "active",
      updatedAt: new Date(),
    },
  });
}