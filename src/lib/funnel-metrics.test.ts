import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { msBetween, northStarRate, userHasNorthStar } from "./funnel-metrics";

describe("funnel-metrics", () => {
  it("msBetween returns positive delta", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-01-01T00:01:00Z");
    assert.equal(msBetween(a, b), 60_000);
  });

  it("northStarRate", () => {
    assert.equal(
      northStarRate({
        registered: 10,
        withSite: 8,
        firstMessage: 7,
        previewReady: 5,
        activatedSharers: 2,
      }),
      0.2
    );
  });

  it("userHasNorthStar", () => {
    assert.equal(userHasNorthStar({ hasPreviewReady: true, hasCopyOrShare: true }), true);
    assert.equal(userHasNorthStar({ hasPreviewReady: true, hasCopyOrShare: false }), false);
  });
});
