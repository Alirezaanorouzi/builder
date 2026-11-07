import { getConfig } from "@/lib/config";

export type CursorTransport = "direct" | "gateway";

function authHeaderApiKey(apiKey: string): string {
  const encoded = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { message?: string; code?: string };
    return json.message || json.code || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

export function parseCursorError(status: number, bodySnippet: string): string {
  const short = bodySnippet.slice(0, 500);
  if (status === 401 || status === 403) {
    return `Cursor API denied the request (${status}): ${short}`;
  }
  return `Cursor API error (${status}): ${short}`;
}

/** Used in user-facing errors when the hop is ambiguous. */
export function isGatewayTransport(): boolean {
  return getConfig().cursorTransport === "gateway";
}

export function cursorStreamUrl(agentId: string, runId: string): string {
  const { cursorApiBase } = getConfig();
  return `${cursorApiBase.replace(/\/$/, "")}/v1/agents/${agentId}/runs/${runId}/stream`;
}

export function cursorAuthHeader(): string {
  const cfg = getConfig();
  if (cfg.cursorTransport === "gateway") {
    const tok = cfg.engineGatewayToken;
    if (!tok) throw new Error("ENGINE_GATEWAY_TOKEN is required when CURSOR_TRANSPORT=gateway");
    return `Bearer ${tok}`;
  }
  if (!cfg.cursorApiKey) throw new Error("CURSOR_API_KEY is required when CURSOR_TRANSPORT=direct");
  return authHeaderApiKey(cfg.cursorApiKey);
}

/**
 * Same-origin Cursor Agent API URL (direct or via gateway).
 */
function cursorApiUrl(path: string): string {
  const cfg = getConfig();
  const base = cfg.cursorApiBase.replace(/\/$/, "");
  const p = path.replace(/^\//, "");
  return `${base}/${p}`;
}

/** POST JSON to Cursor (through gateway when configured). */
export async function cursorPostJson(path: string, body: unknown): Promise<Response> {
  return fetch(cursorApiUrl(path), {
    method: "POST",
    headers: {
      Authorization: cursorAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** POST cancel — allow-listed on the gateway. */
export async function cancelCursorRun(agentId: string, runId: string): Promise<void> {
  const res = await fetch(
    cursorApiUrl(`v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`),
    { method: "POST", headers: { Authorization: cursorAuthHeader() } }
  );
  if (res.ok || res.status === 404) return;
  const text = await res.text();
  const hint = isGatewayTransport() ? "gateway or Cursor" : "Cursor";
  throw new Error(`${hint} cancel failed (${res.status}): ${parseCursorError(res.status, text)}`);
}

/** Run states from `GET /v1/agents/{id}/runs/{runId}`. */
export type CursorRunStatus =
  | "CREATING"
  | "RUNNING"
  | "WAITING_FOR_BACKGROUND_WORK"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export interface CursorRunInfo {
  id: string;
  agentId: string;
  status: CursorRunStatus;
  result?: string;
}

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "CREATING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);

export function isCursorRunActive(status: string): boolean {
  return ACTIVE_RUN_STATUSES.has(status.toUpperCase());
}

/**
 * Fetch one run (used to recover after a restart). Returns `null` when Cursor no longer
 * knows the run (404); throws on other HTTP errors.
 */
export async function getCursorRun(agentId: string, runId: string): Promise<CursorRunInfo | null> {
  const res = await fetch(
    cursorApiUrl(`v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`),
    { headers: { Authorization: cursorAuthHeader() } }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    const hint = isGatewayTransport() ? "gateway or Cursor" : "Cursor";
    throw new Error(`${hint} get run failed (${res.status}): ${parseCursorError(res.status, text)}`);
  }
  const data = (await res.json()) as Partial<CursorRunInfo> & { status?: string };
  return {
    id: data.id ?? runId,
    agentId: data.agentId ?? agentId,
    status: String(data.status ?? "").toUpperCase() as CursorRunStatus,
    result: data.result,
  };
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
