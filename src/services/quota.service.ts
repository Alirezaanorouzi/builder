import { prisma } from "@/lib/db";
import {
  addUnits,
  toView,
  weigh,
  type TokenUsage,
  type UsageState,
} from "@/lib/quota/engine";
import { DEFAULT_PLAN, PLANS, SYNC_SCHEDULE_MS } from "@/lib/quota/plans";
import { getCursorRunUsage } from "@/services/cursor.service";
import type { UserUsage } from "@prisma/client";

const EMPTY: UsageState = {
  phase: 0,
  windowUnits: BigInt(0),
  lockedUntil: null,
  lastUsageAt: null,
};

const planOf = (id?: string | null) => PLANS[id ?? ""] ?? PLANS[DEFAULT_PLAN];

function rowToState(row: UserUsage): UsageState {
  return {
    phase: row.phase,
    windowUnits: row.windowUnits,
    lockedUntil: row.lockedUntil,
    lastUsageAt: row.lastUsageAt,
  };
}

export class QuotaLockedError extends Error {
  readonly view: ReturnType<typeof toView>;

  constructor(view: ReturnType<typeof toView>) {
    super("QUOTA_LOCKED");
    this.name = "QuotaLockedError";
    this.view = view;
  }
}

function quotaEnforced(): boolean {
  return process.env.QUOTA_ENFORCE?.trim() === "1";
}

export async function getUsageView(userId: string) {
  const row = await prisma.userUsage.findUnique({ where: { userId } });
  return toView(row ? rowToState(row) : EMPTY, planOf(row?.planId), new Date());
}

export async function assertCanRun(userId: string) {
  const view = await getUsageView(userId);
  if (!quotaEnforced()) return;
  if (view.lockedUntil) throw new QuotaLockedError(view);
}

export async function enqueueRunUsage(p: {
  buildRunId: string;
  userId: string;
  agentId: string;
  runId: string;
}) {
  try {
    await prisma.runUsage.upsert({
      where: { buildRunId: p.buildRunId },
      create: {
        buildRunId: p.buildRunId,
        userId: p.userId,
        agentId: p.agentId,
        runId: p.runId,
        nextSyncAt: new Date(),
      },
      update: {},
    });
  } catch (e) {
    console.warn("[quota] run usage upsert failed", p.buildRunId, e);
    return;
  }
  void syncRunUsage(p.buildRunId).catch((e) => console.warn("[quota] sync", e));
}

export async function syncRunUsage(buildRunId: string) {
  const head = await prisma.runUsage.findUnique({ where: { buildRunId } });
  if (!head?.nextSyncAt) return;

  let usage: TokenUsage | null = null;
  try {
    usage = await getCursorRunUsage(head.agentId, head.runId);
  } catch (e) {
    console.warn("[quota] usage fetch failed", buildRunId, e);
  }

  await prisma.$transaction(async (tx) => {
    await tx.userUsage.upsert({
      where: { userId: head.userId },
      create: { userId: head.userId },
      update: {},
    });

    const locked = await tx.$queryRaw<UserUsage[]>`
      SELECT * FROM "UserUsage" WHERE "userId" = ${head.userId} FOR UPDATE`;

    const u = locked[0];
    if (!u) return;

    const r = await tx.runUsage.findUniqueOrThrow({ where: { buildRunId } });
    const units = usage ? weigh(usage) : r.units;
    const delta = units > r.appliedUnits ? units - r.appliedUnits : BigInt(0);
    const nextMs = SYNC_SCHEDULE_MS[r.syncCount + 1];
    const now = new Date();

    await tx.runUsage.update({
      where: { buildRunId },
      data: {
        units,
        appliedUnits: r.appliedUnits + delta,
        ...(usage ? { tokens: usage as object } : {}),
        syncCount: r.syncCount + 1,
        nextSyncAt: nextMs != null ? new Date(now.getTime() + nextMs) : null,
      },
    });

    if (delta > BigInt(0)) {
      const next = addUnits(rowToState(u), planOf(u.planId), delta, now);
      await tx.userUsage.update({
        where: { userId: head.userId },
        data: {
          phase: next.phase,
          windowUnits: next.windowUnits,
          lockedUntil: next.lockedUntil,
          lastUsageAt: next.lastUsageAt,
        },
      });
    }
  });
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      await tasks[idx]!();
    }
  });
  await Promise.all(workers);
}

const SYNC_BATCH = 5;
const SYNC_CONCURRENCY = 2;

export async function processDueUsageSyncs(limit = SYNC_BATCH) {
  const due = await prisma.runUsage.findMany({
    where: { nextSyncAt: { lte: new Date() } },
    orderBy: { nextSyncAt: "asc" },
    take: limit,
    select: { buildRunId: true },
  });
  await runWithConcurrency(
    due.map((d) => () => syncRunUsage(d.buildRunId).catch((e) => console.warn("[quota]", e))),
    SYNC_CONCURRENCY
  );
}

let syncing = false;

export function kickUsageSync() {
  if (syncing) return;
  syncing = true;
  void processDueUsageSyncs()
    .catch((e) => console.warn("[quota] sync batch", e))
    .finally(() => {
      syncing = false;
    });
}

export async function upgradePlan(userId: string, planId: string) {
  if (!PLANS[planId]) throw new Error(`Unknown plan: ${planId}`);
  await prisma.userUsage.upsert({
    where: { userId },
    create: { userId, planId },
    update: {
      planId,
      phase: 0,
      windowUnits: BigInt(0),
      lockedUntil: null,
    },
  });
}
