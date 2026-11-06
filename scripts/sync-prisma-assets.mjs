/** Rebuild scripts/prisma-assets.mjs from src/lib/db (run after schema/migration edits). */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join("src", "lib", "db");
const schema = readFileSync(join(root, "schema.prisma"), "utf8");
const lock = readFileSync(join(root, "migrations", "migration_lock.toml"), "utf8");
const migrations = {};
for (const name of readdirSync(join(root, "migrations"))) {
  if (name === "migration_lock.toml") continue;
  migrations[name] = readFileSync(join(root, "migrations", name, "migration.sql"), "utf8");
}
writeFileSync(
  "prisma-assets.mjs",
  `export const prismaSchema = ${JSON.stringify(schema)};\n` +
    `export const migrationLock = ${JSON.stringify(lock)};\n` +
    `export const migrations = ${JSON.stringify(migrations)};\n`
);
console.log("Updated prisma-assets.mjs");
