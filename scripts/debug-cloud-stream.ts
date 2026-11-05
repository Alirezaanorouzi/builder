/**
 * Debug Cloud Agent REST stream — logs raw SSE event types.
 * Usage: npx tsx scripts/debug-cloud-stream.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { Agent } from "@cursor/sdk";
import { getConfig, getCursorModelSelection } from "../src/lib/config";
import { streamCloudAgentRun } from "../src/services/cursor-cloud-stream";

config({ path: resolve(process.cwd(), ".env.local"), override: true });

const repoUrl =
  process.env.PROBE_CURSOR_REPO_URL?.trim() ??
  process.env.TEMPLATE_REPO_URL?.trim() ??
  "";
const ref = process.env.TEMPLATE_REPO_REF?.trim() || "main";
const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Reply with one short sentence only: confirm you received this message.";

async function main() {
  const cfg = getConfig();
  if (!cfg.cursorApiKey) {
    console.error("Missing CURSOR_API_KEY");
    process.exit(1);
  }
  if (!repoUrl) {
    console.error("Set PROBE_CURSOR_REPO_URL or TEMPLATE_REPO_URL");
    process.exit(1);
  }

  console.log("Prompt:", prompt);
  console.log("Repo:", repoUrl);

  const agent = await Agent.create({
    apiKey: cfg.cursorApiKey,
    model: getCursorModelSelection(),
    cloud: {
      repos: [{ url: repoUrl, startingRef: ref }],
      workOnCurrentBranch: true,
      autoCreatePR: false,
    },
  });

  try {
    const run = await agent.send(prompt);
    console.log("agentId:", agent.agentId, "runId:", run.id);

    let eventCount = 0;
    const finished = await streamCloudAgentRun(agent.agentId, run.id, (ev) => {
      eventCount++;
      console.log(`[${eventCount}]`, ev.type, ev.type === "assistant" ? ev.text.slice(0, 80) : ev);
    });

    const result = await run.wait();
    console.log("stream finished:", finished, "wait:", result.status);
    console.log("total mapped events:", eventCount);
  } finally {
    await agent.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
