import { prisma } from "@/lib/db";
import { isPreviewUnlocked, isSameCommit } from "@/lib/preview-gate";
import { getDefaultBranchHeadSha } from "@/services/github.service";
import { fetchReadyDeploymentCommitRange } from "@/services/vercel.service";

const previewGateResourceSelect = {
  githubRepoFullName: true,
  vercelProjectId: true,
  vercelTeamId: true,
  githubDefaultBranch: true,
  baselineCommitSha: true,
  productionCommitSha: true,
} as const;

type PreviewGateResourceRow = {
  githubRepoFullName: string | null;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  githubDefaultBranch: string;
  baselineCommitSha: string | null;
  productionCommitSha: string | null;
};

export async function recordBaselineCommit(siteId: string, sha: string): Promise<void> {
  const trimmed = sha.trim();
  if (!trimmed) return;
  await prisma.siteResources.update({
    where: { siteId },
    data: {
      baselineCommitSha: trimmed,
      productionCommitSha: trimmed,
      updatedAt: new Date(),
    },
  });
}

export async function recordProductionCommit(siteId: string, sha: string): Promise<void> {
  const trimmed = sha.trim();
  if (!trimmed) return;
  const current = await prisma.siteResources.findUnique({
    where: { siteId },
    select: { productionCommitSha: true },
  });
  if (current?.productionCommitSha && isSameCommit(current.productionCommitSha, trimmed)) {
    return;
  }
  await prisma.siteResources.update({
    where: { siteId },
    data: {
      productionCommitSha: trimmed,
      updatedAt: new Date(),
    },
  });
}

/** When preview is still locked, sync production SHA from git (fast) then Vercel (deploy truth). */
export async function refreshProductionCommitWhenLocked(siteId: string): Promise<void> {
  const row = await prisma.siteResources.findUnique({
    where: { siteId },
    select: previewGateResourceSelect,
  });
  const r = row as PreviewGateResourceRow | null;
  if (!r?.baselineCommitSha || !r.githubRepoFullName || !r.vercelProjectId) return;
  if (isPreviewUnlocked(r)) return;

  const head = await getDefaultBranchHeadSha(r.githubRepoFullName, r.githubDefaultBranch).catch(
    () => null
  );
  if (head && !isSameCommit(r.baselineCommitSha, head)) {
    await recordProductionCommit(siteId, head);
    return;
  }

  const range = await fetchReadyDeploymentCommitRange({
    projectId: r.vercelProjectId,
    teamId: r.vercelTeamId ?? undefined,
  });
  if (range.newest && !isSameCommit(r.baselineCommitSha, range.newest)) {
    await recordProductionCommit(siteId, range.newest);
  }
}

/**
 * Backfill baseline / production SHAs for sites provisioned before the preview gate existed.
 * Uses Vercel deployment history (oldest vs newest READY) when baseline is missing.
 */
export async function ensurePreviewGateFields(site: { id: string }): Promise<void> {
  const row = await prisma.siteResources.findUnique({
    where: { siteId: site.id },
    select: previewGateResourceSelect,
  });
  const r = row as PreviewGateResourceRow | null;
  if (!r?.githubRepoFullName || !r.vercelProjectId) return;

  if (!r.baselineCommitSha || !r.productionCommitSha) {
    let baseline: string | null = r.baselineCommitSha;
    let production: string | null = r.productionCommitSha;

    const range = await fetchReadyDeploymentCommitRange({
      projectId: r.vercelProjectId,
      teamId: r.vercelTeamId ?? undefined,
    });

    if (!baseline) {
      baseline =
        range.oldest ??
        (await getDefaultBranchHeadSha(r.githubRepoFullName, r.githubDefaultBranch).catch(
          (): string | null => null
        ));
    }

    if (!production) {
      production = range.newest ?? baseline;
    }

    if (baseline || production) {
      await prisma.siteResources.update({
        where: { siteId: site.id },
        data: {
          ...(baseline ? { baselineCommitSha: baseline } : {}),
          ...(production ? { productionCommitSha: production } : {}),
          updatedAt: new Date(),
        },
      });
    }
  }

  await refreshProductionCommitWhenLocked(site.id);
}
