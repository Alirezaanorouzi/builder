/**
 * Restore DATABASE_URL on the Liara app from .env.local (public host).
 * Does not print the connection string.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (process.env.LIARA_TEAM_ID || "").trim();
const appId = (process.env.LIARA_APP_ID || "builder1").trim();
const raw = (process.env.DATABASE_URL || "").trim();

if (!token || !raw) {
  console.error("Need LIARA_API_KEY and DATABASE_URL in .env.local");
  process.exit(1);
}

const u = new URL(raw);
console.log(
  `Restoring DATABASE_URL on ${appId}: host=${u.hostname} port=${u.port} db=${u.pathname}`
);

const args = [
  "liara",
  "env",
  "set",
  `DATABASE_URL=${raw}`,
  "--app",
  appId,
  "--force",
  "--api-token",
  token,
];
if (teamId) args.push("--team-id", teamId);

const r = spawnSync("npx", args, {
  encoding: "utf8",
  cwd: process.cwd(),
  shell: true,
});
if (r.stdout) console.log(r.stdout.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://***"));
if (r.stderr) console.error(r.stderr.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://***"));
process.exit(r.status ?? 1);
