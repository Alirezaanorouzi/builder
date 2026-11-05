/**
 * Minimal Cursor Cloud Agent create — same shape as src/services/cursor.service.ts
 * Usage: npx tsx scripts/probe-cursor-agent.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { cursorAgentModelField, resolveCursorModelId } from "../src/lib/config";

config({ path: resolve(process.cwd(), ".env.local"), override: true });

const apiKey = process.env.CURSOR_API_KEY?.trim();
const repoUrl =
  process.env.PROBE_CURSOR_REPO_URL?.trim() ??
  "https://github.com/Alirezaanorouzi/builder-default-sf2f238w";
const ref = process.env.TEMPLATE_REPO_REF?.trim() || "main";
const modelId = resolveCursorModelId();

if (!apiKey) {
  console.error("Missing CURSOR_API_KEY in .env.local");
  process.exit(1);
}

const cursorApiKey = apiKey;

function basicAuth(key: string): string {
  return `Basic ${Buffer.from(`${key}:`, "utf8").toString("base64")}`;
}

async function main() {
  const body: Record<string, unknown> = {
    name: "probe-website-builder",
    prompt: { text: "Create a simple landing page." },
    repos: [{ url: repoUrl, startingRef: ref }],
    workOnCurrentBranch: true,
    autoCreatePR: false,
  };
  Object.assign(body, cursorAgentModelField(modelId));

  console.log("POST https://api.cursor.com/v1/agents");
  console.log("Auth: Basic (apiKey:…) — not Bearer");
  console.log("Repo:", repoUrl, "ref:", ref, "model:", modelId);

  const res = await fetch("https://api.cursor.com/v1/agents", {
    method: "POST",
    headers: {
      Authorization: basicAuth(cursorApiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text.slice(0, 800));

  if (res.ok) {
    try {
      const data = JSON.parse(text) as { agent?: { id: string }; run?: { id: string } };
      console.log("OK — agent:", data.agent?.id, "run:", data.run?.id);
    } catch {
      /* logged above */
    }
  } else {
    process.exit(1);
  }
}

void main();
