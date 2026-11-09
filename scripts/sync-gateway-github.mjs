/**
 * Copy builder/gateway → a clone of Alirezaanorouzi/builder-cursor-gateway and push (Vercel source).
 *
 *   node scripts/sync-gateway-github.mjs           # sync only
 *   node scripts/sync-gateway-github.mjs --push  # commit + push when diff
 *
 * Env:
 *   GATEWAY_GITHUB_REPO=owner/repo   (default builder-cursor-gateway)
 *   GATEWAY_SYNC_DIR=path            (default: OS temp)
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const gatewaySrc = join(root, "gateway");
const repo =
  process.env.GATEWAY_GITHUB_REPO?.trim() || "Alirezaanorouzi/builder-cursor-gateway";
const workDir =
  process.env.GATEWAY_SYNC_DIR?.trim() ||
  join(tmpdir(), "builder-cursor-gateway-sync");

const push = process.argv.includes("--push");

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function copyGateway() {
  const skip = new Set(["node_modules", ".next", ".git"]);
  for (const name of readdirSync(gatewaySrc)) {
    if (skip.has(name)) continue;
    const from = join(gatewaySrc, name);
    const to = join(workDir, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true });
    } else {
      cpSync(from, to);
    }
  }
}

if (!existsSync(gatewaySrc)) {
  console.error("Missing gateway/ in builder repo");
  process.exit(1);
}

mkdirSync(workDir, { recursive: true });
const gitDir = join(workDir, ".git");
if (!existsSync(gitDir)) {
  run("git", ["clone", "--depth", "1", `https://github.com/${repo}.git`, workDir], root);
} else {
  run("git", ["fetch", "origin"], workDir);
  run("git", ["checkout", "main"], workDir);
  run("git", ["pull", "--ff-only", "origin", "main"], workDir);
}

copyGateway();

const status = spawnSync("git", ["status", "--porcelain"], { cwd: workDir, encoding: "utf8" });
const dirty = (status.stdout || "").trim();
if (!dirty) {
  console.log(`[gateway-sync] ${repo}: already in sync`);
  process.exit(0);
}

console.log("[gateway-sync] changes:\n", dirty);
if (!push) {
  console.log("\nRe-run with --push to commit and push to GitHub (triggers Vercel).");
  process.exit(0);
}

const msg =
  process.env.GATEWAY_SYNC_MESSAGE?.trim() ||
  "Sync from builder/gateway (monorepo)";
run("git", ["add", "-A"], workDir);
run("git", ["commit", "-m", msg], workDir);
run("git", ["push", "origin", "main"], workDir);
console.log(`[gateway-sync] pushed to https://github.com/${repo}`);
