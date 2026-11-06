/**
 * Production build: materialize Prisma files, migrate when DATABASE_URL is set, then Next.js.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

run("node scripts/prisma-postinstall.mjs");

if (process.env.DATABASE_URL?.trim()) {
  run("npx prisma migrate deploy --schema=src/lib/db/schema.prisma");
}

run("npx next build");
