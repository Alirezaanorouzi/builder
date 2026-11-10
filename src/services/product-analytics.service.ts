import { prisma } from "@/lib/db";
import { isPreviewUnlocked } from "@/lib/preview-gate";
import { SHARE_COPY_EVENTS, isProductEventName, type ProductEventName } from "@/lib/product-events";
import { msBetween, northStarRate, userHasNorthStar, type NorthStarCounts } from "@/lib/funnel-metrics";
import type { BuildRunStatus, Prisma } from "@prisma/client";

const MAX_EVENTS_PER_REQUEST = 20;

export async function recordProductEvents(input: {
  userId: string;
  siteId?: string | null;
  events: { name: string; props?: Record<string, unknown> }[];
}) {
  const rows = input.events
    .filter((e) => isProductEventName(e.name))
    .slice(0, MAX_EVENTS_PER_REQUEST)
    .map((e) => ({
      userId: input.userId,
      siteId: input.siteId ?? null,
      name: e.name as ProductEventName,
      props: e.props ? (e.props as Prisma.InputJsonValue) : undefined,
    }));
  if (rows.length === 0) return 0;
  await prisma.productEvent.createMany({ data: rows });
  return rows.length;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getMetricsOverview() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const todayStart = startOfUtcDay(now);

  const [registered, usersWithSite, firstMessage, previewReady] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { sites: { some: {} } } }),
    prisma.user.count({
      where: { sites: { some: { buildRuns: { some: {} } } } },
    }),
    prisma.user.count({
      where: {
        sites: {
          some: {
            buildRuns: {
              some: {
                status: "succeeded" as BuildRunStatus,
                OR: [{ deployUrl: { not: null } }, { commitSha: { not: null } }],
              },
            },
          },
        },
      },
    }),
  ]);

  const funnelUserRows = await buildUserFunnelRows({ limit: 10_000, offset: 0 });
  const activatedSharers = funnelUserRows.users.filter((u) =>
    userHasNorthStar({ hasPreviewReady: u.hasPreviewReady, hasCopyOrShare: u.copyShareCount > 0 })
  ).length;

  const counts: NorthStarCounts = {
    registered,
    withSite: usersWithSite,
    firstMessage,
    previewReady,
    activatedSharers,
  };

  const dailyNorthStar = await dailyActivatedSharers(sevenDaysAgo, now);

  const eventCounts7d = await prisma.productEvent.groupBy({
    by: ["name"],
    where: { createdAt: { gte: sevenDaysAgo } },
    _count: { _all: true },
  });

  return {
    northStar: {
      label: "activated_sharers",
      rate: northStarRate(counts),
      counts,
    },
    funnel: counts,
    last7Days: {
      northStarDaily: dailyNorthStar,
      productEvents: Object.fromEntries(eventCounts7d.map((r) => [r.name, r._count._all])),
    },
    tokensToday: await sumTokensSince(todayStart),
  };
}

async function sumTokensSince(since: Date) {
  const rows = await prisma.runUsage.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { appliedUnits: true },
  });
  return rows._sum.appliedUnits?.toString() ?? "0";
}

async function dailyActivatedSharers(from: Date, to: Date) {
  const days: { date: string; count: number }[] = [];
  let cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  while (cursor <= end) {
    const next = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const count = await countActivatedSharersInWindow(cursor, next);
    days.push({ date: cursor.toISOString().slice(0, 10), count });
    cursor = next;
  }
  return days;
}

async function countActivatedSharersInWindow(from: Date, to: Date) {
  const sharers = await prisma.productEvent.findMany({
    where: {
      name: { in: [...SHARE_COPY_EVENTS] },
      createdAt: { gte: from, lt: to },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  let n = 0;
  for (const { userId } of sharers) {
    const ready = await userHasPreviewReady(userId, to);
    if (ready) n += 1;
  }
  return n;
}

async function userHasPreviewReady(userId: string, before?: Date): Promise<boolean> {
  const run = await prisma.buildRun.findFirst({
    where: {
      site: { userId },
      status: "succeeded",
      ...(before ? { finishedAt: { lte: before } } : {}),
      OR: [{ deployUrl: { not: null } }, { commitSha: { not: null } }],
    },
    orderBy: { finishedAt: "asc" },
    include: { site: { include: { resources: true } } },
  });
  if (!run) return false;
  if (run.deployUrl) return true;
  return isPreviewUnlocked(run.site.resources);
}

export type UserFunnelRow = {
  userId: string;
  email: string;
  registeredAt: string;
  siteCount: number;
  hasSite: boolean;
  firstMessageAt: string | null;
  msToFirstMessage: number | null;
  firstPreviewAt: string | null;
  msFirstMessageToPreview: number | null;
  hasPreviewReady: boolean;
  editCountAfterFirstPreview: number;
  previewTabOpens: number;
  copyShareCount: number;
  externalOpenCount: number;
  lastAppOpenAt: string | null;
  msSinceLastReturn: number | null;
  tokensToday: string;
};

export async function buildUserFunnelRows(options: { limit: number; offset: number }) {
  const limit = Math.min(options.limit, 100);
  const offset = options.offset;
  const todayStart = startOfUtcDay(new Date());

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        email: true,
        createdAt: true,
        _count: { select: { sites: true } },
      },
    }),
    prisma.user.count(),
  ]);

  const rows: UserFunnelRow[] = [];
  for (const user of users) {
    rows.push(await funnelRowForUser(user.id, user.email, user.createdAt, user._count.sites, todayStart));
  }

  return { users: rows, total, limit, offset };
}

async function funnelRowForUser(
  userId: string,
  email: string,
  registeredAt: Date,
  siteCount: number,
  todayStart: Date
): Promise<UserFunnelRow> {
  const runs = await prisma.buildRun.findMany({
    where: { site: { userId } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      deployUrl: true,
      finishedAt: true,
      createdAt: true,
      site: { select: { resources: true } },
    },
  });

  const firstRun = runs[0] ?? null;
  const firstSucceededIdx = runs.findIndex(
    (r) =>
      r.status === "succeeded" &&
      (r.deployUrl != null || isPreviewUnlocked(r.site.resources))
  );
  const firstSucceeded = firstSucceededIdx >= 0 ? runs[firstSucceededIdx] : null;
  const editCountAfterFirstPreview =
    firstSucceededIdx >= 0 ? Math.max(0, runs.length - firstSucceededIdx - 1) : 0;

  const [eventGroups, tokenSum, appOpens] = await Promise.all([
    prisma.productEvent.groupBy({
      by: ["name"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.runUsage.aggregate({
      where: { userId, createdAt: { gte: todayStart } },
      _sum: { appliedUnits: true },
    }),
    prisma.productEvent.findMany({
      where: { userId, name: "app_open" },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { createdAt: true },
    }),
  ]);

  const countFor = (name: ProductEventName) =>
    eventGroups.find((g) => g.name === name)?._count._all ?? 0;

  const copyShareCount =
    countFor("preview_link_copied") + countFor("preview_link_shared");

  const lastAppOpen = appOpens[0]?.createdAt ?? null;
  const prevAppOpen = appOpens[1]?.createdAt ?? null;
  const msSinceLastReturn = msBetween(prevAppOpen, lastAppOpen);

  const firstMessageAt = firstRun?.createdAt ?? null;
  const firstPreviewAt = firstSucceeded?.finishedAt ?? firstSucceeded?.createdAt ?? null;

  return {
    userId,
    email,
    registeredAt: registeredAt.toISOString(),
    siteCount,
    hasSite: siteCount > 0,
    firstMessageAt: firstMessageAt?.toISOString() ?? null,
    msToFirstMessage: msBetween(registeredAt, firstMessageAt),
    firstPreviewAt: firstPreviewAt?.toISOString() ?? null,
    msFirstMessageToPreview: msBetween(firstMessageAt, firstPreviewAt),
    hasPreviewReady: firstSucceeded != null,
    editCountAfterFirstPreview: editCountAfterFirstPreview,
    previewTabOpens: countFor("preview_tab_open"),
    copyShareCount,
    externalOpenCount: countFor("preview_external_open"),
    lastAppOpenAt: lastAppOpen?.toISOString() ?? null,
    msSinceLastReturn,
    tokensToday: tokenSum._sum.appliedUnits?.toString() ?? "0",
  };
}

export async function listRecentUserMessages(options: { limit: number; offset: number }) {
  const limit = Math.min(options.limit, 100);
  const offset = options.offset;
  const [runs, total] = await Promise.all([
    prisma.buildRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        userMessage: true,
        createdAt: true,
        site: { select: { userId: true, user: { select: { email: true } } } },
      },
    }),
    prisma.buildRun.count(),
  ]);
  return {
    messages: runs.map((r) => ({
      buildRunId: r.id,
      userId: r.site.userId,
      userEmail: r.site.user.email,
      text: r.userMessage,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    limit,
    offset,
  };
}

export async function listFeatureFlags() {
  return prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
}

export async function setFeatureFlag(key: string, enabled: boolean) {
  return prisma.featureFlag.update({
    where: { key },
    data: { enabled },
  });
}

export async function getPublicFeatureFlags(): Promise<Record<string, boolean>> {
  const rows = await prisma.featureFlag.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
}
