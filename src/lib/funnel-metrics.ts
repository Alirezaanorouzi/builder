/** Pure helpers for admin funnel / North Star calculations. */

export function msBetween(start: Date | null | undefined, end: Date | null | undefined): number | null {
  if (!start || !end) return null;
  const d = end.getTime() - start.getTime();
  return d >= 0 ? d : null;
}

export function userHasNorthStar(a: {
  hasPreviewReady: boolean;
  hasCopyOrShare: boolean;
}): boolean {
  return a.hasPreviewReady && a.hasCopyOrShare;
}

export type NorthStarCounts = {
  registered: number;
  withSite: number;
  firstMessage: number;
  previewReady: number;
  activatedSharers: number;
};

export function northStarRate(counts: NorthStarCounts): number {
  if (counts.registered === 0) return 0;
  return counts.activatedSharers / counts.registered;
}
