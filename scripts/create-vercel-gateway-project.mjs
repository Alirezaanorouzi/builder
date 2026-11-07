/**
 * Create a Vercel project for builder-cursor-gateway (reads VERCEL_TOKEN + VERCEL_TEAM_ID from .env.local).
 * Usage from repo root: node scripts/create-vercel-gateway-project.mjs
 *
 * Does not print secret values.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const token = process.env.VERCEL_TOKEN?.trim();
const teamId = process.env.VERCEL_TEAM_ID?.trim();
const repo =
  process.env.GATEWAY_GITHUB_REPO?.trim() || "Alirezaanorouzi/builder-cursor-gateway";
const projectName =
  process.env.VERCEL_GATEWAY_PROJECT_NAME?.trim() || "builder-cursor-gateway";

if (!token) {
  console.error("Missing VERCEL_TOKEN in .env.local");
  process.exit(1);
}
if (!teamId) {
  console.error("Missing VERCEL_TEAM_ID in .env.local");
  process.exit(1);
}

const url = new URL("https://api.vercel.com/v10/projects");
url.searchParams.set("teamId", teamId);

const body = {
  name: projectName,
  framework: "nextjs",
  rootDirectory: null,
  gitRepository: {
    type: "github",
    repo,
  },
  resourceConfig: {
    functionDefaultRegions: ["fra1"],
  },
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error("Vercel API error:", res.status, text.slice(0, 800));
  process.exit(1);
}

let data;
try {
  data = JSON.parse(text);
} catch {
  console.error("Invalid JSON from Vercel");
  process.exit(1);
}

console.log("Created or linked Vercel project:");
console.log("  id:", data.id);
console.log("  name:", data.name);
console.log("  link:", `https://vercel.com/${data.accountId || teamId}/${data.name}`);
console.log("  GitHub repo:", repo);
console.log("\nAdd env vars in Vercel dashboard: CURSOR_API_KEY, ENGINE_GATEWAY_TOKEN");
