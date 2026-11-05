import { cursorAgentModelField, getConfig } from "@/lib/config";

function authHeader(apiKey: string): string {
  const encoded = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

export interface CreateAgentResult {
  agentId: string;
  runId: string;
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { message?: string; code?: string };
    return json.message || json.code || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

import type { TenantContext } from "@engines/types";

export async function createAgentWithRun(
  promptText: string,
  tenant: TenantContext
): Promise<CreateAgentResult> {
  const cfg = getConfig();
  const body: Record<string, unknown> = {
    name: "Website builder session",
    prompt: { text: promptText },
    repos: [
      {
        url: tenant.repoUrl,
        startingRef: tenant.repoRef,
      },
    ],
    workOnCurrentBranch: true,
    autoCreatePR: false,
    ...cursorAgentModelField(cfg.cursorModelId),
  };

  const res = await fetch(`${cfg.cursorApiBase}/v1/agents`, {
    method: "POST",
    headers: {
      Authorization: authHeader(cfg.cursorApiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Cursor create agent failed (${res.status}): ${await parseError(res)}`);
  }

  const data = (await res.json()) as {
    agent: { id: string };
    run: { id: string };
  };

  return { agentId: data.agent.id, runId: data.run.id };
}

export async function sendFollowUpRun(
  agentId: string,
  promptText: string
): Promise<{ runId: string }> {
  const cfg = getConfig();

  const res = await fetch(`${cfg.cursorApiBase}/v1/agents/${agentId}/runs`, {
    method: "POST",
    headers: {
      Authorization: authHeader(cfg.cursorApiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: { text: promptText },
      ...cursorAgentModelField(cfg.cursorModelId),
    }),
  });

  if (!res.ok) {
    throw new Error(`Cursor follow-up failed (${res.status}): ${await parseError(res)}`);
  }

  const data = (await res.json()) as { run: { id: string } };
  return { runId: data.run.id };
}

export function cursorStreamUrl(agentId: string, runId: string): string {
  const cfg = getConfig();
  return `${cfg.cursorApiBase}/v1/agents/${agentId}/runs/${runId}/stream`;
}

export function cursorAuthHeader(): string {
  return authHeader(getConfig().cursorApiKey);
}

export function friendlyToolActivity(name: string, status: string): string | null {
  if (status === "running") {
    if (name.includes("terminal") || name === "run_terminal_cmd") {
      return "Running commands…";
    }
    if (name.includes("browser") || name === "computerUse") {
      return "Testing in browser…";
    }
    if (name.includes("read") || name.includes("write") || name.includes("edit") || name === "search_replace") {
      return "Updating website files…";
    }
    return `Working (${name})…`;
  }
  return null;
}
