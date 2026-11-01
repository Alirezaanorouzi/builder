import { getCodingEngineId } from "@/lib/config";
import { prisma } from "@/lib/db";
import { enqueueSiteProvisioning } from "@/services/provisioning.service";
import {
  siteHasDedicatedResources,
  type SiteWithResources,
} from "@/lib/site-runtime";
import type { CodingEngine } from "@prisma/client";

const DEFAULT_SITE_SLUG = "default";

export function serializeSiteForClient(site: SiteWithResources) {
  return {
    id: site.id,
    slug: site.slug,
    displayName: site.displayName,
    status: site.status,
    provisioningStep: site.resources?.provisioningStep ?? null,
    provisioningError: site.resources?.provisioningError ?? null,
    productionUrl: site.resources?.productionUrl ?? null,
    githubRepoFullName: site.resources?.githubRepoFullName ?? null,
  };
}

/** Start or resume GitHub + Vercel provisioning when the site has no dedicated resources yet. */
export async function syncSiteProvisioning(site: SiteWithResources): Promise<void> {
  const hasDedicated = siteHasDedicatedResources(site);

  // Race: provisioning marked failed after GitHub + Vercel were saved — unblock the user.
  if (site.status === "failed" && hasDedicated) {
    await prisma.site.update({
      where: { id: site.id },
      data: { status: "active", updatedAt: new Date() },
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
    await prisma.site.update({
      where: { id: site.id },
      data: { status: "provisioning", updatedAt: new Date() },
    });
    status = "provisioning";
  }

  if (status === "provisioning" || status === "failed") {
    enqueueSiteProvisioning(site.id);
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
  enqueueSiteProvisioning(created.id);
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
  enqueueSiteProvisioning(site.id);
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

export async function setChatSessionEngineAgentId(chatSessionId: string, engineAgentId: string) {
  return prisma.chatSession.update({
    where: { id: chatSessionId },
    data: { engineAgentId, updatedAt: new Date() },
  });
}
