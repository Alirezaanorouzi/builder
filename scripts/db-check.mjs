/**
 * Read-only DB diagnostics (no secrets printed): connectivity, applied migrations, key tables.
 * Usage: node scripts/db-check.mjs
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();
try {
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  console.log(`connected in ${Date.now() - t0}ms`);

  const migs = await prisma.$queryRaw`
    SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
    FROM "_prisma_migrations" ORDER BY started_at`;
  console.log("migrations:");
  for (const m of migs) console.log(`  ${m.finished ? "ok " : "PENDING"} ${m.rolled_back ? "(rolled back) " : ""}${m.migration_name}`);

  const seq = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'BuildEvent' AND column_name = 'seq'`;
  console.log("BuildEvent.seq column:", seq.length ? "present" : "MISSING");

  for (const table of ["user", "session", "Site", "SiteResources", "BuildRun", "BuildEvent"]) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`);
      console.log(`  ${table}: ${rows[0].n} rows`);
    } catch (e) {
      console.log(`  ${table}: (query failed: ${e.code ?? "error"})`);
    }
  }
} catch (e) {
  const detail = String(e.message ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-2)
    .join(" | ")
    .replace(/:\/\/[^@\s]+@/g, "://***@");
  console.error("DB check failed:", e.code ?? e.name, detail);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
