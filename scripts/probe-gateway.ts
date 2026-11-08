/**
 * Quick check: Liara/builder → Vercel gateway (401 without token) and optional routes.
 *
 * Usage:
 *   npx tsx scripts/probe-gateway.ts
 *   npx tsx scripts/probe-gateway.ts --vercel-deployments
 *
 * Requires in .env.local: ENGINE_GATEWAY_URL, ENGINE_GATEWAY_TOKEN (and optional ENGINE_GATEWAY_TOKEN_VERCEL).
 */
import { config } from "dotenv";
import { resolve } from "node:path";

const root = process.cwd();
config({ path: resolve(root, ".env.local"), override: true });

const base = process.env.ENGINE_GATEWAY_URL?.trim().replace(/\/$/, "");
const token = process.env.ENGINE_GATEWAY_TOKEN?.trim();
const vercelToken =
  process.env.ENGINE_GATEWAY_TOKEN_VERCEL?.trim() || token;

async function main() {
  if (!base) {
    console.error("Set ENGINE_GATEWAY_URL in .env.local (e.g. https://your-app.vercel.app)");
    process.exit(1);
  }

  const noAuth = await fetch(`${base}/api/cursor/v1/agents?limit=1`);
  console.log("Without Bearer → Cursor:", noAuth.status, noAuth.status === 401 ? "OK" : "(expected 401)");

  const noAuthVercel = await fetch(`${base}/api/vercel/v6/deployments?projectId=prj_test`);
  console.log(
    "Without Bearer → Vercel:",
    noAuthVercel.status,
    noAuthVercel.status === 401 ? "OK" : "(expected 401)"
  );

  if (!token) {
    console.log("ENGINE_GATEWAY_TOKEN not set — skipping authenticated Cursor probe.");
  } else {
    const withAuth = await fetch(`${base}/api/cursor/v1/agents?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await withAuth.text();
    console.log("With Bearer → Cursor:", withAuth.status, text.slice(0, 120));
  }

  if (process.argv.includes("--vercel-deployments")) {
    const projectId = process.env.VERCEL_PROJECT_ID?.trim();
    if (!vercelToken) {
      console.error("Set ENGINE_GATEWAY_TOKEN_VERCEL or ENGINE_GATEWAY_TOKEN for Vercel route probe.");
      process.exit(1);
    }
    if (!projectId || !/^prj_/.test(projectId)) {
      console.error("Set VERCEL_PROJECT_ID (prj_…) in .env.local for --vercel-deployments");
      process.exit(1);
    }
    const url = `${base}/api/vercel/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=5`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${vercelToken}` } });
    const body = (await res.json()) as {
      deployments?: Array<{ uid?: string; meta?: { githubCommitSha?: string } }>;
      error?: string;
    };
    console.log("With Bearer → Vercel deployments:", res.status);
    if (!res.ok) {
      console.log(body);
      process.exit(1);
    }
    const d = body.deployments?.[0];
  const keys = d ? Object.keys(d) : [];
    const okShape =
      Array.isArray(body.deployments) &&
      (body.deployments.length === 0 ||
        (d?.uid && keys.every((k) => ["uid", "url", "readyState", "state", "target", "created", "createdAt", "meta"].includes(k))));
    console.log(okShape ? "Filtered deployment shape OK" : "Unexpected deployment shape", keys);
  }
}

void main();
