/** Compare Git SHAs with prefix tolerance (Vercel / GitHub may use short forms). */
export function isSameCommit(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

/** Preview gate columns on SiteResources (explicit — matches prisma/schema.prisma). */
export type PreviewGateFields = {
  baselineCommitSha?: string | null;
  productionCommitSha?: string | null;
  productionUrl?: string | null;
};

/** User-facing preview is allowed only after a deploy beyond the template baseline. */
export function isPreviewUnlocked(resources: PreviewGateFields | null | undefined): boolean {
  if (!resources?.baselineCommitSha || !resources.productionCommitSha) {
    return false;
  }
  return !isSameCommit(resources.baselineCommitSha, resources.productionCommitSha);
}

/** Production URL for iframe / links — omitted until the commit gate passes. */
export function clientProductionUrl(resources: PreviewGateFields | null | undefined): string | null {
  if (!resources?.productionUrl || !isPreviewUnlocked(resources)) {
    return null;
  }
  return resources.productionUrl;
}
