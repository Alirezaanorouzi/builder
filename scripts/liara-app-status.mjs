/**
 * Recent releases + events for a Liara app (PaaS API).
 * Usage: node scripts/liara-app-status.mjs
 *
 * Helps debug "container unhealthy" — check latest release `state` and event messages.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const appName = (process.env.LIARA_APP_ID || process.env.LIARA_APP || "builder1").trim();
const teamId = (process.env.LIARA_TEAM_ID || process.env.LIARA_TEAM || "").trim();
const base =
  (process.env.LIARA_API_BASE || "https://api.iran.liara.ir").trim().replace(/\/$/, "");

if (!token) {
  console.error("Set LIARA_API_TOKEN or LIARA_API_KEY");
  process.exit(1);
}

function withTeam(url) {
  if (teamId) url.searchParams.set("teamID", teamId);
}

async function getJson(path, search = new URLSearchParams()) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of search) url.searchParams.set(k, v);
  withTeam(url);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${path} → ${res.status}`, text.slice(0, 500));
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error("Invalid JSON:", text.slice(0, 300));
    return null;
  }
}

const now = Math.floor(Date.now() / 1000);
const start = now - 24 * 60 * 60;

console.log("=== Releases (latest 5) ===\n");
const rel = await getJson(`/v1/projects/${encodeURIComponent(appName)}/releases`, new URLSearchParams([["page", "1"], ["count", "5"]]));
if (rel?.releases?.length) {
  for (const r of rel.releases.slice(0, 5)) {
    console.log({
      state: r.state,
      port: r.port,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      message: r.gitInfo?.message,
      tag: r.tag,
    });
  }
} else {
  console.log(JSON.stringify(rel, null, 2)?.slice(0, 2000) || "(no data)");
}

console.log("\n=== Events (last 24h, sample) ===\n");
const ev = await getJson(`/v1/projects/${encodeURIComponent(appName)}/events`, new URLSearchParams([["start", String(start)], ["end", String(now)]]));
if (ev?.data?.length) {
  const tail = ev.data.slice(-25);
  for (const row of tail) {
    const meta = row.metaData?.values;
    const line = Array.isArray(meta?.[0]) ? meta[0].join(" ") : JSON.stringify(meta || row).slice(0, 200);
    console.log(line);
  }
} else {
  console.log(JSON.stringify(ev, null, 2)?.slice(0, 4000) || "(no events)");
}
