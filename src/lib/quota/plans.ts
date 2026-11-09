export const H = 3_600_000;

export type Phase = { quota: number; lockMs: number };
export type Plan = { phases: Phase[]; resetAfterIdleMs: number };

/** Phase caps in weighted units (see WEIGHTS). Pure input ≈ same token count. */
export const PLANS: Record<string, Plan> = {
  free: {
    phases: [
      { quota: 10_000_000, lockMs: 1 * H },
      { quota: 12_000_000, lockMs: 3 * H },
      { quota: 15_000_000, lockMs: 5 * H },
    ],
    resetAfterIdleMs: 24 * H,
  },
};

export const DEFAULT_PLAN = "free";

/**
 * composer-2.5 $/1M tokens (normalized to input @ $0.50/M → weight 1):
 * input $0.50, cache read $0.20, output $2.50; cache write ≈ input (undocumented).
 */
export const WEIGHTS = {
  input: 1,
  output: 5,
  cacheWrite: 1,
  cacheRead: 0.4,
} as const;

/** Sync at 0, 1, 5, 30 minutes after run (omit 30m by using length 4 with last null). */
export const SYNC_SCHEDULE_MS = [0, 60_000, 300_000, 1_800_000] as const;
