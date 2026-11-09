import { WEIGHTS, type Plan } from "./plans";

export type UsageState = {
  phase: number;
  windowUnits: bigint;
  lockedUntil: Date | null;
  lastUsageAt: Date | null;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export function weigh(u: TokenUsage): bigint {
  return BigInt(
    Math.round(
      u.inputTokens * WEIGHTS.input +
        u.outputTokens * WEIGHTS.output +
        u.cacheWriteTokens * WEIGHTS.cacheWrite +
        u.cacheReadTokens * WEIGHTS.cacheRead
    )
  );
}

export function settle(s: UsageState, plan: Plan, now: Date): UsageState {
  let r = s;
  if (r.lockedUntil && r.lockedUntil <= now) {
    r = {
      ...r,
      phase: Math.min(r.phase + 1, plan.phases.length - 1),
      windowUnits: BigInt(0),
      lockedUntil: null,
    };
  }
  if (
    !r.lockedUntil &&
    r.lastUsageAt &&
    now.getTime() - r.lastUsageAt.getTime() >= plan.resetAfterIdleMs
  ) {
    r = { ...r, phase: 0, windowUnits: BigInt(0) };
  }
  return r;
}

export function addUnits(s: UsageState, plan: Plan, delta: bigint, now: Date): UsageState {
  const r = settle(s, plan, now);
  const windowUnits = r.windowUnits + delta;
  const p = plan.phases[r.phase]!;
  const hitLimit = !r.lockedUntil && windowUnits >= BigInt(p.quota);
  return {
    ...r,
    windowUnits,
    lastUsageAt: now,
    lockedUntil: hitLimit ? new Date(now.getTime() + p.lockMs) : r.lockedUntil,
  };
}

export function toView(s: UsageState, plan: Plan, now: Date) {
  const r = settle(s, plan, now);
  const p = plan.phases[r.phase]!;
  const quota = BigInt(p.quota);
  const usedPercent =
    quota > BigInt(0)
      ? Math.min(100, Number((r.windowUnits * BigInt(100)) / quota))
      : 0;
  return {
    phase: r.phase + 1,
    usedPercent,
    lockedUntil: r.lockedUntil?.toISOString() ?? null,
  };
}
