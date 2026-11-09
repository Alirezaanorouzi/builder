/**
 * Copy builder/template → builder-clinic-template on GitHub (provisioning source).
 *
 *   node scripts/sync-template-github.mjs
 *   node scripts/sync-template-github.mjs --push
 *
 * Env:
 *   TEMPLATE_GITHUB_REPO=owner/repo   (default Alirezaanorouzi/builder-clinic-template)
 *   TEMPLATE_SYNC_DIR=path
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const templateSrc = join(root, "template");
const repo =
  process.env.TEMPLATE_GITHUB_REPO?.trim() || "Alirezaanorouzi/tempelate1";
const workDir =
  process.env.TEMPLATE_SYNC_DIR?.trim() || join(tmpdir(), "builder-clinic-template-sync");

const push = process.argv.includes("--push");

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function copyTemplate() {
  const skip = new Set(["node_modules", ".next", ".git"]);
  const sourceNames = new Set(readdirSync(templateSrc));
  for (const name of readdirSync(workDir)) {
    if (skip.has(name) || sourceNames.has(name)) continue;
    rmSync(join(workDir, name), { recursive: true, force: true });
  }
  for (const name of sourceNames) {
    if (skip.has(name)) continue;
    const from = join(templateSrc, name);
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

if (!existsSync(templateSrc)) {
  console.error("Missing template/ in builder repo");
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

copyTemplate();

const status = spawnSync("git", ["status", "--porcelain"], { cwd: workDir, encoding: "utf8" });
const dirty = (status.stdout || "").trim();
if (!dirty) {
  console.log(`[template-sync] ${repo}: already in sync`);
  process.exit(0);
}

console.log("[template-sync] changes:\n", dirty);
if (!push) {
  console.log("\nRe-run with --push to commit and push to GitHub.");
  process.exit(0);
}

const msg =
  process.env.TEMPLATE_SYNC_MESSAGE?.trim() ||
  `Foundation template v2 (TEMPLATE_VERSION from monorepo)`;
run("git", ["add", "-A"], workDir);
run("git", ["commit", "-m", msg], workDir);
run("git", ["push", "origin", "main"], workDir);
console.log(`[template-sync] pushed to https://github.com/${repo}`);
