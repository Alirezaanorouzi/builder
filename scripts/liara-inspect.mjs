/**
 * Inspect Liara app + env (keys and shape only — no secret values).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

const root = process.cwd();
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (process.env.LIARA_TEAM_ID || process.env.LIARA_TEAM || "").trim();
const appId = (process.env.LIARA_APP_ID || process.env.LIARA_APP || "builder1").trim();

if (!token) {
  console.error("Missing LIARA_API_TOKEN / LIARA_API_KEY in .env.local");
  process.exit(1);
}

function liara(args) {
  const full = ["liara", ...args, "--api-token", token];
  if (teamId) full.push("--team-id", teamId);
  return spawnSync("npx", full, {
    encoding: "utf8",
    cwd: root,
    shell: process.platform === "win32",
  });
}

const required = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CURSOR_API_KEY",
  "TEMPLATE_REPO_URL",
  "TEMPLATE_REPO_REF",
  "PLATFORM_GITHUB_TOKEN",
  "GITHUB_REPO_OWNER",
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
];
const recommended = ["INLINE_BUILD_WORKER"];

console.log("=== Liara CLI credentials (.env.local) ===");
console.log("token present:", Boolean(token), `(${token.length} chars)`);
console.log("team id:", teamId || "(missing)");
console.log("app id:", appId);
console.log("");

const apps = liara(["app", "list", "--output", "json"]);
if (apps.status !== 0) {
  console.error("app list failed:\n", apps.stderr || apps.stdout);
  process.exit(apps.status ?? 1);
}

let appRows = [];
try {
  const parsed = JSON.parse(apps.stdout || "[]");
  appRows = Array.isArray(parsed) ? parsed : parsed.data || parsed.apps || [];
} catch {
  console.log("app list parse failed");
}

const app = Array.isArray(appRows)
  ? appRows.find((a) => a.name === appId || a.id === appId)
  : null;

console.log("=== App ===");
if (!app) {
  console.log(`App "${appId}" not found on this team.`);
  console.log(
    "Known apps:",
    Array.isArray(appRows) ? appRows.map((a) => `${a.name} (${a.platform}, ${a.status})`).join(", ") : "none"
  );
} else {
  console.log({
    name: app.name,
    platform: app.platform,
    plan: app.plan,
    status: app.status,
    scale: app.scale,
    network: app.network || app.privateNetwork || undefined,
  });
  if (app.platform !== "next") {
    console.log("NOTE: platform is not next — deploy script uses --platform=next.");
  }
  if (String(app.status).toUpperCase() !== "ACTIVE" && String(app.status).toUpperCase() !== "RUNNING") {
    console.log("NOTE: app status is not ACTIVE.");
  }
}

console.log("");
const envRes = liara(["env", "list", "--app", appId, "--output", "json"]);
if (envRes.status !== 0) {
  console.error("env list failed:\n", envRes.stderr || envRes.stdout);
  process.exit(envRes.status ?? 1);
}

let envRows = [];
try {
  envRows = JSON.parse(envRes.stdout || "[]");
} catch {
  console.log("env list (raw, truncated):\n", (envRes.stdout || "").slice(0, 1500));
  process.exit(1);
}

const map = new Map();
if (Array.isArray(envRows)) {
  for (const row of envRows) {
    const key = row.key || row.name || row.Name;
    const value = row.value ?? row.Value ?? "";
    if (key) map.set(key, String(value));
  }
} else if (envRows && typeof envRows === "object") {
  for (const [key, value] of Object.entries(envRows)) {
    map.set(key, String(value ?? ""));
  }
}

function summarize(key, value) {
  const v = value.trim();
  const info = { key, set: v.length > 0, length: v.length };
  if (key === "DATABASE_URL") {
    info.looksPostgres = v.startsWith("postgres");
    info.hasSslMode = /sslmode=/i.test(v);
    info.hostHint = v.includes("liara.cloud")
      ? "liara.cloud (public)"
      : v.includes(".iran.liara.ir") || v.includes("db-")
        ? "possibly private/internal"
        : "other";
  }
  if (key === "BETTER_AUTH_URL") {
    info.isLocalhost = /localhost|127\.0\.0\.1/i.test(v);
    info.usesHttps = v.startsWith("https://");
    info.host = v.replace(/^https?:\/\//, "").split("/")[0] || "(empty)";
  }
  if (key === "TEMPLATE_REPO_URL") {
    info.hasGithub = /github\.com/i.test(v);
  }
  if (key === "INLINE_BUILD_WORKER") {
    info.value = v;
  }
  return info;
}

console.log("=== Env keys on Liara (values hidden) ===");
if (map.size === 0) {
  console.log("No environment variables on this app.");
} else {
  for (const key of [...map.keys()].sort()) {
    console.log(JSON.stringify(summarize(key, map.get(key) || "")));
  }
}

console.log("");
console.log("=== Required for this builder ===");
const missing = [];
for (const key of required) {
  const ok = map.has(key) && (map.get(key) || "").trim().length > 0;
  console.log(`${ok ? "OK " : "MISSING "} ${key}`);
  if (!ok) missing.push(key);
}
for (const key of recommended) {
  const ok = map.has(key) && (map.get(key) || "").trim().length > 0;
  console.log(`${ok ? "OK " : "MISSING (recommended) "} ${key}`);
}

const db = map.get("DATABASE_URL") || "";
if (db && !/sslmode=/i.test(db) && /liara\.cloud/i.test(db)) {
  console.log("WARN DATABASE_URL: public Liara host without sslmode=require");
}
const authUrl = map.get("BETTER_AUTH_URL") || "";
if (authUrl && /localhost|127\.0\.0\.1/i.test(authUrl)) {
  console.log("WARN BETTER_AUTH_URL is localhost — must be the public Liara URL");
}

if (missing.length) {
  console.log("\nSet missing vars in Liara console or: npx liara env set KEY=value --app " + appId);
  process.exit(2);
}
console.log("\nAll required env keys are present.");
