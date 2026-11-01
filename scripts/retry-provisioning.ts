/**
 * One-shot: retry provisioning for all failed/provisioning sites.
 * Usage: npx tsx scripts/retry-provisioning.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db";
import { runSiteProvisioning } from "../src/services/provisioning.service";

async function main() {
  const sites = await prisma.site.findMany({
    where: { status: { in: ["failed", "provisioning"] } },
    select: { id: true, status: true },
  });
  if (!sites.length) {
    console.log("No failed/provisioning sites.");
    return;
  }
  for (const site of sites) {
    console.log("Provisioning", site.id, site.status);
    await runSiteProvisioning(site.id);
    const after = await prisma.site.findUnique({
      where: { id: site.id },
      include: { resources: true },
    });
    console.log(
      "  →",
      after?.status,
      after?.resources?.githubRepoFullName,
      after?.resources?.vercelProjectId,
      after?.resources?.provisioningError?.slice(0, 80)
    );
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
