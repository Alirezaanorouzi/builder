import { prisma } from "@/lib/db";
import type { SiteStatus } from "@prisma/client";

export async function transitionSiteStatus(
  siteId: string,
  toStatus: SiteStatus,
  options?: { message?: string; suspendReason?: string | null; setActivatedAt?: boolean }
) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return null;
  if (site.status === toStatus && !options?.message) {
    return site;
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.site.update({
      where: { id: siteId },
      data: {
        status: toStatus,
        statusChangedAt: now,
        updatedAt: now,
        ...(options?.suspendReason !== undefined ? { suspendReason: options.suspendReason } : {}),
        ...(options?.setActivatedAt || toStatus === "active"
          ? { activatedAt: site.activatedAt ?? now }
          : {}),
      },
    });
    await tx.siteStatusEvent.create({
      data: {
        siteId,
        fromStatus: site.status,
        toStatus,
        message: options?.message ?? null,
      },
    });
    return updated;
  });
}

export async function listSiteStatusEvents(siteId: string, limit = 20) {
  return prisma.siteStatusEvent.findMany({
    where: { siteId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listSitesByStatus(status: SiteStatus, limit = 50) {
  return prisma.site.findMany({
    where: { status },
    orderBy: { statusChangedAt: "asc" },
    take: limit,
    include: { resources: true, user: { select: { id: true, email: true } } },
  });
}
