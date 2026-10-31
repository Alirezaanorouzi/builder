import { randomBytes } from "crypto";
import { getConfig } from "@/lib/config";

function basicAuth(): string {
  const cfg = getConfig();
  const encoded = Buffer.from(`${cfg.opencodeServerUsername}:${cfg.opencodeServerPassword}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

function baseUrl(): string {
  return getConfig().opencodeServerUrl.replace(/\/$/, "");
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { message?: string; error?: string };
    return json.message || json.error || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

export async function opencodeFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuth(),
      ...(init?.headers ?? {}),
    },
  });
}

export async function healthCheck(): Promise<void> {
  const res = await opencodeFetch("/global/health");
  if (!res.ok) {
    throw new Error(`OpenCode server unreachable (${res.status}): ${await parseError(res)}`);
  }
}

export interface OpencodeSession {
  id: string;
  title?: string;
}

export async function createSession(title: string): Promise<OpencodeSession> {
  const res = await opencodeFetch("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    throw new Error(`OpenCode create session failed (${res.status}): ${await parseError(res)}`);
  }
  return (await res.json()) as OpencodeSession;
}

export function newOpenCodeMessageId(): string {
  return `msg_${randomBytes(12).toString("hex")}`;
}

export function parseOpencodeModel(slug: string): { providerID: string; modelID: string } {
  const s = slug.trim() || "openrouter/openrouter/free";
  const i = s.indexOf("/");
  if (i === -1) return { providerID: s, modelID: s };
  return { providerID: s.slice(0, i), modelID: s.slice(i + 1) };
}

export async function promptAsync(sessionId: string, text: string, messageId: string): Promise<void> {
  const cfg = getConfig();
  const res = await opencodeFetch(`/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageID: messageId,
      agent: "build",
      model: parseOpencodeModel(cfg.opencodeModel),
      parts: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenCode prompt failed (${res.status}): ${await parseError(res)}`);
  }
}

type SessionStatusMap = Record<
  string,
  { type?: string; status?: string; running?: boolean } | string
>;

export async function getSessionStatus(sessionId: string): Promise<string> {
  const res = await opencodeFetch("/session/status");
  if (!res.ok) {
    throw new Error(`OpenCode status failed (${res.status}): ${await parseError(res)}`);
  }
  const data = (await res.json()) as SessionStatusMap;
  const entry = data[sessionId];
  if (!entry) return "unknown";
  if (typeof entry === "string") return entry;
  if (entry.type) return entry.type;
  if (entry.status) return entry.status;
  if (entry.running) return "running";
  return "unknown";
}

export type OpenCodeRunOutcome = "success" | "failed" | "timeout";

function sessionMatches(data: unknown, sessionId: string): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  const props = o.properties;
  if (props && typeof props === "object") {
    const p = props as Record<string, unknown>;
    if (p.sessionID === sessionId || p.sessionId === sessionId) return true;
  }
  if (o.sessionID === sessionId || o.sessionId === sessionId) return true;
  const session = o.session;
  if (session && typeof session === "object") {
    const s = session as Record<string, unknown>;
    if (s.id === sessionId) return true;
  }
  return false;
}

function busEventType(data: unknown): string {
  if (!data || typeof data !== "object") return "message";
  const t = (data as { type?: string }).type;
  return typeof t === "string" ? t : "message";
}

function friendlyBusEvent(type: string, data: unknown): string | null {
  const props =
    data && typeof data === "object"
      ? ((data as { properties?: Record<string, unknown> }).properties ?? {})
      : {};

  if (type === "session.updated") {
    const info = props.info as { model?: { providerID?: string; id?: string; modelID?: string } } | undefined;
    const m = info?.model;
    if (m?.providerID && (m.id || m.modelID)) {
      return `Model: ${m.providerID}/${m.id ?? m.modelID}`;
    }
    return null;
  }
  if (type === "session.status") {
    const status = props.status as { type?: string } | undefined;
    if (status?.type === "busy") return "Agent working…";
    return null;
  }
  if (type === "message.part.updated") {
    const part = props.part as { type?: string; tool?: string; name?: string; text?: string } | undefined;
    if (part?.type === "tool") {
      const name = part.tool ?? part.name;
      return name ? `Tool: ${name}` : "Running tool…";
    }
    if (part?.type === "text" && part.text && part.text.length < 120) {
      return null;
    }
  }
  if (type === "session.diff") return "Applying file changes…";
  return null;
}

/** Subscribe to OpenCode bus events (best-effort; falls back to status polling only). */
export async function watchOpenCodeSession(
  sessionId: string,
  deadlineMs: number,
  onActivity: (message: string) => void,
  onError: (message: string) => void
): Promise<OpenCodeRunOutcome> {
  const deadline = Date.now() + deadlineMs;
  let outcome: OpenCodeRunOutcome | null = null;
  let sawBusy = false;

  const eventPaths = ["/event", "/global/event"];

  const pollStatus = async () => {
    while (!outcome && Date.now() < deadline) {
      const status = (await getSessionStatus(sessionId)).toLowerCase();
      if (status.includes("busy") || status.includes("run")) {
        sawBusy = true;
      } else if (sawBusy && (status === "idle" || status.includes("idle"))) {
        outcome = "success";
        return;
      }
      await sleep(2000);
    }
  };

  const handleBusEvent = (data: unknown) => {
    if (!sessionMatches(data, sessionId)) return;
    const type = busEventType(data);
    const props =
      data && typeof data === "object"
        ? ((data as { properties?: Record<string, unknown> }).properties ?? {})
        : {};

    if (type === "session.status") {
      const st = props.status as { type?: string } | undefined;
      const stType = st?.type?.toLowerCase() ?? "";
      if (stType.includes("busy") || stType.includes("run")) sawBusy = true;
      else if (sawBusy && (stType.includes("idle") || stType === "completed")) {
        outcome = "success";
      }
    }
    if (type === "session.error" || type === "message.error") {
      outcome = "failed";
      onError("OpenCode agent run failed");
      return;
    }
    const friendly = friendlyBusEvent(type, data);
    if (friendly) onActivity(friendly);
  };

  const readEvents = async () => {
    for (const path of eventPaths) {
      if (outcome) return;
      const res = await opencodeFetch(path, {
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) continue;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!outcome && Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          if (!block.trim()) continue;
          let dataLine = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }
          if (!dataLine) continue;
          let data: unknown = dataLine;
          try {
            data = JSON.parse(dataLine) as unknown;
          } catch {
            continue;
          }
          handleBusEvent(data);
          if (outcome) return;
        }
      }
      try {
        reader.cancel();
      } catch {
        /* ignore */
      }
      if (!outcome) break;
    }
  };

  await Promise.race([
    Promise.all([pollStatus(), readEvents()]),
    sleep(deadlineMs).then(() => {
      if (!outcome) outcome = "timeout";
    }),
  ]);

  if (!outcome && sawBusy) outcome = "success";
  return outcome ?? "timeout";
}

export async function pushGitChanges(sessionId: string, ref: string): Promise<void> {
  // Runs inside the OpenCode container; uses TEMPLATE_REPO_GIT_* from docker compose env.
  const authorFlags =
    'git -c user.email="${TEMPLATE_REPO_GIT_EMAIL}" -c user.name="${TEMPLATE_REPO_GIT_NAME:-Website Builder}"';
  const cmd = [
    "git add -A",
    'if git diff --staged --quiet; then true; else',
    `${authorFlags} commit -m "Website builder update"; fi`,
    // Agent may have committed with a wrong author — rewrite HEAD before push (Vercel Hobby checks author).
    `${authorFlags} commit --amend --reset-author --no-edit 2>/dev/null || true`,
    `git push origin ${ref}`,
  ].join(" && ");
  const res = await opencodeFetch(`/session/${sessionId}/shell`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: "build",
      command: cmd,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenCode git push failed (${res.status}): ${await parseError(res)}`);
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
