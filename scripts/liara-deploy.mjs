/**
 * Deploy to Liara using credentials from .env.local (not loaded by the Liara CLI itself).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (
  process.env.LIARA_TEAM_ID ||
  process.env.LIARA_TEAM ||
  ""
).trim();
let appId = (process.env.LIARA_APP_ID || process.env.LIARA_APP || "").trim();

if (!token) {
  console.error(
    "Missing Liara API token. Add LIARA_API_TOKEN or LIARA_API_KEY to .env.local."
  );
  process.exit(1);
}

function liara(args) {
  const full = ["liara", ...args, "--api-token", token];
  if (teamId) full.push("--team-id", teamId);
  return spawnSync("npx", full, {
    stdio: "inherit",
    cwd: root,
    shell: process.platform === "win32",
  });
}

if (!appId) {
  console.error("Missing LIARA_APP_ID in .env.local.\n");
  console.error("Apps in your team (use the Name as LIARA_APP_ID):\n");
  liara(["app", "list"]);
  console.error("\nThen add: LIARA_APP_ID=your-app-name");
  process.exit(1);
}

console.log(
  `Deploying to Liara app "${appId}"${teamId ? ` (team ${teamId.slice(0, 8)}…)` : ""}…`
);

const deployArgs = ["deploy", "--platform=next", "--app", appId];
// Full rebuild without Docker/npm cache — much slower. Default off so occasional CLI deploys are faster.
if (process.env.LIARA_DEPLOY_NO_CACHE?.trim() === "1") {
  deployArgs.push("--no-cache");
}
const result = liara(deployArgs);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
