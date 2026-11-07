/**
 * Copy app env from .env.local onto the Liara app (does not print secret values).
 *
 * Skips CLI-only keys (LIARA_API_* / LIARA_TEAM_ID / LIARA_APP_ID).
 * Rewrites localhost BETTER_AUTH_URL to https://<app>.liara.run unless LIARA_PUBLIC_URL is set.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (process.env.LIARA_TEAM_ID || process.env.LIARA_TEAM || "").trim();
const appId = (process.env.LIARA_APP_ID || process.env.LIARA_APP || "").trim();

if (!token || !appId) {
  console.error("Need LIARA_API_TOKEN (or LIARA_API_KEY) and LIARA_APP_ID in .env.local");
  process.exit(1);
}

const SKIP = new Set([
  "LIARA_API_TOKEN",
  "LIARA_API_KEY",
  "LIARA_TEAM_ID",
  "LIARA_TEAM",
  "LIARA_APP_ID",
  "LIARA_APP",
  "LIARA_PUBLIC_URL",
]);

const KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CURSOR_TRANSPORT",
  "CURSOR_API_KEY",
  "ENGINE_GATEWAY_URL",
  "ENGINE_GATEWAY_TOKEN",
  "CURSOR_MODEL_ID",
  "CURSOR_COMPOSER_FAST",
  "TEMPLATE_REPO_URL",
  "TEMPLATE_REPO_REF",
  "PLATFORM_GITHUB_TOKEN",
  "GITHUB_REPO_OWNER",
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
  "VERCEL_PRODUCTION_URL",
  "ADMIN_EMAILS",
  "WORKER_MODE",
  "WORKER_ID",
  "WORKER_POLL_MS",
  "PROVISIONING_LEASE_MINUTES",
  "INLINE_BUILD_WORKER",
];

function rewriteValue(key, raw) {
  let value = raw.trim();
  if (!value) return "";

  if (key === "BETTER_AUTH_URL") {
    const publicUrl = (process.env.LIARA_PUBLIC_URL || "").trim().replace(/\/$/, "");
    const isLocal = /localhost|127\.0\.0\.1/i.test(value);
    if (publicUrl) return publicUrl;
    if (isLocal) return `https://${appId}.liara.run`;
    return value.replace(/\/$/, "");
  }

  if (key === "DATABASE_URL") {
    if (/sslmode=disable/i.test(value)) {
      value = value.replace(/sslmode=disable/i, "sslmode=require");
    }
  }

  return value;
}

const pairs = [];
const skippedEmpty = [];
const rewritten = [];

for (const key of KEYS) {
  if (SKIP.has(key)) continue;
  const raw = process.env[key];
  if (raw == null || !String(raw).trim()) {
    skippedEmpty.push(key);
    continue;
  }
  const value = rewriteValue(key, String(raw));
  if (!value) {
    skippedEmpty.push(key);
    continue;
  }
  if (value !== String(raw).trim().replace(/\/$/, "")) rewritten.push(key);
  pairs.push(`${key}=${value}`);
}

if (!pairs.length) {
  console.error("No app env vars to sync.");
  process.exit(1);
}

console.log(`Syncing ${pairs.length} env vars to Liara app "${appId}"…`);
if (rewritten.length) console.log("Adjusted for production:", rewritten.join(", "));
if (skippedEmpty.length) console.log("Skipped empty:", skippedEmpty.join(", "));

const liaraBin = resolve(root, "node_modules", "@liara", "cli", "bin", "run.js");
const args = [
  liaraBin,
  "env",
  "set",
  ...pairs,
  "--force",
  "--app",
  appId,
  "--api-token",
  token,
];
if (teamId) args.push("--team-id", teamId);

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Done. Restart or redeploy the Liara app so new env vars load.");
