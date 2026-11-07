/**
 * Fetch recent Liara app logs via the `liara` CLI (npx).
 * Prefer `npm run logs:liara` (scripts/liara-logs-api.mjs) if the CLI fails.
 *
 * Reads LIARA_* from .env.local (token not printed).
 * Liara CLI expects --since like "30 minutes ago", not "15m".
 * Usage: node scripts/liara-tail-logs.mjs
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (process.env.LIARA_TEAM_ID || "").trim();
const appId = (process.env.LIARA_APP_ID || "builder1").trim();
const since = (process.env.LIARA_LOGS_SINCE || "30 minutes ago").trim();
const lastLines = String(process.env.LIARA_LOGS_LINES || "150").trim();

if (!token) {
  console.error("Set LIARA_API_TOKEN or LIARA_API_KEY in .env.local");
  process.exit(1);
}

const args = [
  "liara",
  "logs",
  "--app",
  appId,
  "--since",
  since,
  "--last-lines",
  lastLines,
  "--timestamps",
  "--api-token",
  token,
];
if (teamId) args.push("--team-id", teamId);
if (process.env.LIARA_LOGS_DEBUG === "1") args.push("--debug");

try {
  const text = execFileSync("npx", args, {
    encoding: "utf8",
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 90000,
  });
  console.log(text.slice(-16000));
  process.exit(0);
} catch (e) {
  const err = /** @type {Error & { stdout?: string; stderr?: string; status?: number }} */ (e);
  const out = `${err.stdout || ""}\n${err.stderr || ""}`;
  if (out.trim()) console.log(out.slice(-16000));
  else console.error(err.message || String(e));
  process.exit(err.status ?? 1);
}
