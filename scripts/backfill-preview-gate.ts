/**
 * One-off backfill of preview gate SHAs (baselineCommitSha / productionCommitSha) for sites
 * provisioned before the gate existed, and re-sync of still-locked sites from Vercel.
 *
 *   npm run backfill:preview-gate
 *
 * This used to run on every GET /api/me (two network calls per site per request).
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

import { prisma } from "../src/lib/db";
import { ensurePreviewGateFields } from "../src/services/preview-commit.service";

async function main() {
  const rows = await prisma.siteResources.findMany({
    where: {
      githubRepoFullName: { not: null },
      vercelProjectId: { not: null },
    },
    select: { siteId: true, baselineCommitSha: true, productionCommitSha: true },
  });

  let fixed = 0;
  for (const row of rows) {
    const incomplete = !row.baselineCommitSha || !row.productionCommitSha;
    try {
      await ensurePreviewGateFields({ id: row.siteId });
      if (incomplete) fixed += 1;
    } catch (e) {
      console.error(`[backfill] site ${row.siteId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`[backfill] checked ${rows.length} sites, filled missing fields on ${fixed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
