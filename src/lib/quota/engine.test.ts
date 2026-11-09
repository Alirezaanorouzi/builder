import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addUnits, settle, toView, type UsageState } from "./engine";
import { PLANS } from "./plans";

const plan = PLANS.free;

function state(partial?: Partial<UsageState>): UsageState {
  return {
    phase: 0,
    windowUnits: BigInt(0),
    lockedUntil: null,
    lastUsageAt: null,
    ...partial,
  };
}

describe("quota engine", () => {
  it("phase 1 cap triggers 1h lock", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const next = addUnits(state(), plan, BigInt(10_000_000), now);
    assert.ok(next.lockedUntil);
    assert.equal(next.lockedUntil.getTime(), now.getTime() + plan.phases[0]!.lockMs);
    assert.equal(next.windowUnits, BigInt(10_000_000));
  });

  it("after lock expires advances to phase 2 and clears window", () => {
    const lockedUntil = new Date("2026-01-01T13:00:00Z");
    const now = new Date("2026-01-01T13:01:00Z");
    const settled = settle(
      state({ phase: 0, windowUnits: BigInt(10_000_000), lockedUntil, lastUsageAt: now }),
      plan,
      now
    );
    assert.equal(settled.phase, 1);
    assert.equal(settled.windowUnits, BigInt(0));
    assert.equal(settled.lockedUntil, null);
  });

  it("phase 3 sticks after its lock expires", () => {
    const now = new Date("2026-01-01T20:00:00Z");
    const lockedUntil = new Date(now.getTime() - 1000);
    const settled = settle(
      state({ phase: 2, windowUnits: BigInt(15_000_000), lockedUntil, lastUsageAt: now }),
      plan,
      now
    );
    assert.equal(settled.phase, 2);
  });

  it("24h idle resets to phase 1", () => {
    const last = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-02T01:00:00Z");
    const settled = settle(
      state({ phase: 2, windowUnits: BigInt(1_000), lastUsageAt: last, lockedUntil: null }),
      plan,
      now
    );
    assert.equal(settled.phase, 0);
    assert.equal(settled.windowUnits, BigInt(0));
  });

  it("toView reports locked until", () => {
    const until = new Date("2026-01-01T14:00:00Z");
    const now = new Date("2026-01-01T13:00:00Z");
    const view = toView(state({ lockedUntil: until, windowUnits: BigInt(500) }), plan, now);
    assert.equal(view.lockedUntil, until.toISOString());
  });
});
