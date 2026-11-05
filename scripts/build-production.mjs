/**
 * Production build: run migrations when DATABASE_URL is set (Liara / CI), then Next.js.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

if (process.env.DATABASE_URL?.trim()) {
  run("npx prisma migrate deploy --schema=src/prisma/schema.prisma");
}
run("npx prisma generate --schema=src/prisma/schema.prisma");
run("npx next build");
