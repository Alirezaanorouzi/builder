/**
 * Fetch app logs via the Liara PaaS v2 API (the one `@liara/cli` uses):
 *   GET /v2/projects/{app}/logs?start=<unix_seconds>&direction=forward&last_lines=<bool>[&releaseId=…]
 * (The older v1 endpoint only returns a "please upgrade your client" line.)
 *
 * Does not print the API token.
 * Usage: node scripts/liara-logs-api.mjs [release-tag e.g. v31]
 *
 * Env (.env.local):
 *   LIARA_API_TOKEN or LIARA_API_KEY
 *   LIARA_APP_ID (default builder1)
 *   LIARA_TEAM_ID — optional; sent as ?teamID=
 *   LIARA_LOGS_MINUTES_AGO — default 60
 *   LIARA_LOGS_LIMIT — lines to print from the end (default 200)
 *   LIARA_API_BASE — default https://api.iran.liara.ir
 */
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const appName = (process.env.LIARA_APP_ID || process.env.LIARA_APP || "builder1").trim();
const teamId = (process.env.LIARA_TEAM_ID || process.env.LIARA_TEAM || "").trim();
const minutesAgo = Math.max(1, Number(process.env.LIARA_LOGS_MINUTES_AGO || 60) || 60);
const limit = Math.max(1, Math.min(5000, Number(process.env.LIARA_LOGS_LIMIT || 200) || 200));
const base =
  (process.env.LIARA_API_BASE || "https://api.iran.liara.ir").trim().replace(/\/$/, "");
const releaseTag = (process.argv[2] || "").trim();

if (!token) {
  console.error("Set LIARA_API_TOKEN or LIARA_API_KEY in .env.local");
  process.exit(1);
}

async function api(path, params) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (teamId) url.searchParams.set("teamID", teamId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Liara API ${path} → ${res.status} ${res.statusText}`);
    console.error(text.slice(0, 1500));
    process.exit(1);
  }
  return JSON.parse(text);
}

/** release id ↔ tag map (so lines can be labeled v30, v31, …) */
const releaseTags = new Map();
let releaseId;
{
  const rel = await api(`/v1/projects/${encodeURIComponent(appName)}/releases`, {
    page: 1,
    count: 100,
  });
  for (const r of rel.releases ?? []) {
    releaseTags.set(r._id, r.tag);
    if (releaseTag && r.tag?.toLowerCase() === releaseTag.toLowerCase()) releaseId = r._id;
  }
  if (releaseTag && !releaseId) {
    console.error(`No release with tag "${releaseTag}"`);
    process.exit(1);
  }
}

const params = {
  start: Math.floor(Date.now() / 1000 - minutesAgo * 60),
  direction: "forward",
  last_lines: true,
};
if (releaseId) params.releaseId = releaseId;

const data = await api(`/v2/projects/${encodeURIComponent(appName)}/logs`, params);

const lines = [];
for (const entry of data.data ?? []) {
  const tag = releaseTags.get(entry.metaData?.releaseId) ?? "?";
  for (const [tsNs, line] of entry.values ?? []) {
    lines.push({ ts: BigInt(tsNs), tag, line: String(line) });
  }
}
lines.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

if (!lines.length) {
  console.log("(no log lines in this window)");
  process.exit(0);
}
for (const l of lines.slice(-limit)) {
  const iso = new Date(Number(l.ts / 1000000n)).toISOString();
  console.log(`${iso} [${l.tag}] ${l.line}`);
}
