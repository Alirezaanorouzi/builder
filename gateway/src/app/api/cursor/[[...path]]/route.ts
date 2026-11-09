import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Hobby: max 300s. Pro can raise this in dashboard or `vercel.json` `functions`. */
export const maxDuration = 300;

const CURSOR_ORIGIN = "https://api.cursor.com";

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function cursorBasicAuth(): string {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) throw new Error("CURSOR_API_KEY is not set");
  return `Basic ${Buffer.from(`${key}:`, "utf8").toString("base64")}`;
}

const AGENT_ID_RE = /^bc-[0-9a-f-]{36}$/i;
const RUN_ID_RE = /^run-[0-9a-f-]{36}$/i;

/** Allow-listed Cursor Agent API paths only. */
function isAllowedPath(method: string, relPath: string): boolean {
  const p = relPath.replace(/^\/+|\/+$/g, "");
  if (p === "v1/agents" && method === "POST") return true;
  if (/^v1\/agents\/[^/]+\/runs$/.test(p) && method === "POST") return true;
  if (/^v1\/agents\/[^/]+\/runs\/[^/]+$/.test(p) && method === "GET") return true;
  if (/^v1\/agents\/[^/]+\/runs\/[^/]+\/stream$/.test(p) && method === "GET") return true;
  if (/^v1\/agents\/[^/]+\/runs\/[^/]+\/cancel$/.test(p) && method === "POST") return true;
  if (/^v1\/agents\/[^/]+\/usage$/.test(p) && method === "GET") return true;
  return false;
}

function validateUsageQuery(req: Request, relPath: string): Response | null {
  const p = relPath.replace(/^\/+|\/+$/g, "");
  const usageMatch = p.match(/^v1\/agents\/([^/]+)\/usage$/);
  if (!usageMatch) return null;

  const agentId = usageMatch[1]!;
  if (!AGENT_ID_RE.test(agentId)) {
    return new Response("Invalid agent id", { status: 400 });
  }

  const url = new URL(req.url);
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "runId") {
    return new Response("Only runId query parameter is allowed", { status: 400 });
  }
  const runId = url.searchParams.get("runId")?.trim() ?? "";
  if (!RUN_ID_RE.test(runId)) {
    return new Response("Invalid runId", { status: 400 });
  }
  return null;
}

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const params = await ctx.params;
  return handleProxy(req, params.path ?? [], "GET");
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const params = await ctx.params;
  return handleProxy(req, params.path ?? [], "POST");
}

async function handleProxy(req: Request, segments: string[], method: string) {
  const bearer =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const expected = process.env.ENGINE_GATEWAY_TOKEN?.trim() ?? "";
  if (!expected || !constantTimeEqual(bearer, expected)) {
    return unauthorized();
  }

  const relPath = segments.join("/");
  if (!isAllowedPath(method, relPath)) {
    return new Response("Not Found", { status: 404 });
  }

  const usageQueryError = method === "GET" ? validateUsageQuery(req, relPath) : null;
  if (usageQueryError) return usageQueryError;

  const url = `${CURSOR_ORIGIN}/${relPath}${new URL(req.url).search}`;

  const headers = new Headers();
  headers.set("Authorization", cursorBasicAuth());

  const accept = req.headers.get("accept");
  if (accept) headers.set("Accept", accept);

  const contentType = req.headers.get("content-type");
  if (contentType && method === "POST") headers.set("Content-Type", contentType);

  const lastEventId = req.headers.get("last-event-id");
  if (lastEventId) headers.set("Last-Event-ID", lastEventId);

  try {
    const isStreamPath = relPath.endsWith("/stream");
    const bodyBuf = method === "POST" ? await req.arrayBuffer() : undefined;

    const upstream = await fetch(url, {
      method,
      headers,
      body: bodyBuf && bodyBuf.byteLength > 0 ? bodyBuf : undefined,
    });

    const outHeaders = new Headers();
    const pass = [
      "content-type",
      "cache-control",
      "connection",
    ];
    for (const h of pass) {
      const v = upstream.headers.get(h);
      if (v) outHeaders.set(h, v);
    }
    if (isStreamPath) {
      outHeaders.set("X-Accel-Buffering", "no");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "gateway fetch failed";
    return Response.json({ error: "Gateway upstream error", message }, { status: 502 });
  }
}
