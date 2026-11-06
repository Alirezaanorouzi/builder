/**
 * Production build. Do not migrate here: Liara's Docker build network
 * cannot reach a private (or firewalled public) Postgres. Migrate on start.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

run("node prisma-postinstall.mjs");
run("npx next build");
