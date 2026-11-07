/**
 * Production build. Do not migrate here: Liara's Docker build network
 * cannot reach a private (or firewalled public) Postgres. Migrate on start.
 */
import { execSync } from "node:child_process";
import { globSync, rmSync } from "node:fs";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

function stripCursorSdkSourceMaps() {
  const maps = globSync("node_modules/@cursor/sdk/**/*.d.ts.map");
  for (const file of maps) {
    rmSync(file, { force: true });
  }
  if (maps.length) {
    console.log(`[build] removed ${maps.length} @cursor/sdk .d.ts.map files`);
  }
}

run("node prisma-postinstall.mjs");
stripCursorSdkSourceMaps();
run("npx next build");
