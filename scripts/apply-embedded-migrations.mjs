/**
 * Applies embedded Prisma migrations from prisma-assets.mjs at container start (Node only).
 * Kept out of src/ so Next/webpack never bundles it (instrumentation.ts caused Liara build failures).
 */
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const LOCK_KEY = 7_315_201;

function splitStatements(sql) {
  return sql
    .replace(/\r\n/g, "\n")
    .split(/;[ \t]*\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("[migrate] skip: no DATABASE_URL");
    return;
  }
  if (process.env.SKIP_AUTO_MIGRATE === "1") {
    console.log("[migrate] skip: SKIP_AUTO_MIGRATE=1");
    return;
  }

  const assetsUrl = pathToFileURL(join(process.cwd(), "prisma-assets.mjs")).href;
  const { migrations } = await import(assetsUrl);
  const names = Object.keys(migrations).sort();

  const prisma = new PrismaClient();

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
        await tx.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
            "id" VARCHAR(36) PRIMARY KEY NOT NULL,
            "checksum" VARCHAR(64) NOT NULL,
            "finished_at" TIMESTAMPTZ,
            "migration_name" VARCHAR(255) NOT NULL,
            "logs" TEXT,
            "rolled_back_at" TIMESTAMPTZ,
            "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "applied_steps_count" INTEGER NOT NULL DEFAULT 0
          )`);

        const done = await tx.$queryRawUnsafe(
          `SELECT migration_name FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
        );
        const doneSet = new Set(done.map((r) => r.migration_name));
        const applied = [];

        for (const name of names) {
          if (doneSet.has(name)) continue;
          const sql = migrations[name];
          for (const stmt of splitStatements(sql)) await tx.$executeRawUnsafe(stmt);
          await tx.$executeRawUnsafe(
            `INSERT INTO "_prisma_migrations"
               (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
             VALUES ($1, $2, now(), $3, now(), 1)`,
            randomUUID(),
            createHash("sha256").update(sql).digest("hex"),
            name
          );
          applied.push(name);
        }
        return { applied, skipped: names.length - applied.length };
      },
      { timeout: 120_000, maxWait: 20_000 }
    );

    console.log(
      `[migrate] applied=${result.applied.length ? result.applied.join(",") : "none"} alreadyApplied=${result.skipped}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[migrate] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
