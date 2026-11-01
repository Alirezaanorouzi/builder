import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { prisma } from "../src/lib/db";

async function main() {
  const sites = await prisma.site.findMany({
    include: { resources: true, user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const x of sites) {
    console.log(
      x.user.email,
      x.id.slice(-8),
      x.status,
      x.resources?.githubRepoFullName ?? "-",
      x.resources?.vercelProjectId ?? "-",
      x.resources?.provisioningStep
    );
  }
}

void main().finally(() => prisma.$disconnect());
