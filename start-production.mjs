/**
 * Runtime start: apply migrations (private Liara DB is reachable here), then Next.js.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

if (process.env.DATABASE_URL?.trim()) {
  run("npx prisma migrate deploy --schema=src/lib/db/schema.prisma");
}
run("npx next start");
