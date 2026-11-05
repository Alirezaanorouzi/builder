/**
 * Production build: run migrations when DATABASE_URL is set (Liara / CI), then Next.js.
 */
import { execSync } from "node:child_process";

const schema = "src/lib/db/schema.prisma";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

if (process.env.DATABASE_URL?.trim()) {
  run(`npx prisma migrate deploy --schema=${schema}`);
}
run(`npx prisma generate --schema=${schema}`);
run("npx next build");
