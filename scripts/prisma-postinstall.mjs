/**
 * Liara's Next.js packer omits `.prisma` / `.sql` files from the upload.
 * Recreate them from the JS embed, then generate the Prisma client.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrationLock, migrations, prismaSchema } from "./prisma-assets.mjs";

const schemaDir = join(process.cwd(), "src", "lib", "db");
const schemaPath = join(schemaDir, "schema.prisma");
const migrationsDir = join(schemaDir, "migrations");

mkdirSync(migrationsDir, { recursive: true });
writeFileSync(schemaPath, prismaSchema);
writeFileSync(join(migrationsDir, "migration_lock.toml"), migrationLock);

for (const [name, sql] of Object.entries(migrations)) {
  const dir = join(migrationsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "migration.sql"), sql);
}

execSync(`npx prisma generate --schema=${schemaPath}`, {
  stdio: "inherit",
  env: process.env,
});
