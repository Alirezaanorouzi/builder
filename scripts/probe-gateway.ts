/**
 * Quick check: Liara/builder → Vercel gateway (401 without token) and optional Cursor through gateway.
 *
 * Usage:
 *   npx tsx scripts/probe-gateway.ts
 *   npx tsx scripts/probe-gateway.ts --with-cursor
 *
 * Requires in .env.local: ENGINE_GATEWAY_URL, ENGINE_GATEWAY_TOKEN (and CURSOR_TRANSPORT=gateway for real builds).
 */
import { config } from "dotenv";
import { resolve } from "node:path";

const root = process.cwd();
config({ path: resolve(root, ".env.local"), override: true });

const base = process.env.ENGINE_GATEWAY_URL?.trim().replace(/\/$/, "");
const token = process.env.ENGINE_GATEWAY_TOKEN?.trim();

async function main() {
  if (!base) {
    console.error("Set ENGINE_GATEWAY_URL in .env.local (e.g. https://your-app.vercel.app)");
    process.exit(1);
  }

  const noAuth = await fetch(`${base}/api/cursor/v1/agents?limit=1`);
  console.log("Without Bearer:", noAuth.status, noAuth.status === 401 ? "OK" : "(expected 401)");

  if (!token) {
    console.log("ENGINE_GATEWAY_TOKEN not set — skipping authenticated probe.");
    process.exit(0);
  }

  const withAuth = await fetch(`${base}/api/cursor/v1/agents?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await withAuth.text();
  console.log("With Bearer → Cursor:", withAuth.status, text.slice(0, 120));

  if (process.argv.includes("--with-cursor") && withAuth.ok) {
    console.log("Note: listing agents succeeded; full agent run is not exercised here.");
  }
}

void main();
