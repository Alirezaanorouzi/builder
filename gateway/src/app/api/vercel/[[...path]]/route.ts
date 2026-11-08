import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERCEL_ORIGIN = "https://api.vercel.com";
const UPSTREAM_TIMEOUT_MS = 8_000;

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function gatewayVercelAuthToken(): string {
  return (
    process.env.ENGINE_GATEWAY_TOKEN_VERCEL?.trim() ||
    process.env.ENGINE_GATEWAY_TOKEN?.trim() ||
    ""
  );
}

function unauthorized() {
  return jsonResponse({ error: "Unauthorized" }, 401);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isAllowedPath(method: string, relPath: string): boolean {
  const p = relPath.replace(/^\/+|\/+$/g, "");
  return method === "GET" && p === "v6/deployments";
}

type RawDeployment = {
  uid?: string;
  url?: string;
  readyState?: string;
  state?: string;
  target?: string;
  created?: number;
  createdAt?: number;
  meta?: { githubCommitSha?: string; [key: string]: unknown };
};

function slimDeployments(raw: RawDeployment[]) {
  return raw.map((d) => ({
    uid: d.uid ?? "",
    ...(d.url ? { url: d.url } : {}),
    ...(d.readyState ? { readyState: d.readyState } : {}),
    ...(d.state ? { state: d.state } : {}),
    ...(d.target ? { target: d.target } : {}),
    ...(typeof d.created === "number" ? { created: d.created } : {}),
    ...(typeof d.createdAt === "number" ? { createdAt: d.createdAt } : {}),
  ...(d.meta?.githubCommitSha
      ? { meta: { githubCommitSha: String(d.meta.githubCommitSha).trim() } }
      : {}),
  }));
}

function parseDeploymentsQuery(req: Request): { projectId: string; limit: number } | Response {
  const url = new URL(req.url);
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(["projectId", "limit"]);
  for (const k of keys) {
    if (!allowed.has(k)) {
      if (k === "teamId") {
        return jsonResponse({ error: "teamId is set on the gateway; do not send it from the client" }, 400);
      }
      return jsonResponse({ error: `Unknown query parameter: ${k}` }, 400);
    }
  }

  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  if (!/^prj_[a-zA-Z0-9]+$/.test(projectId)) {
    return jsonResponse({ error: "projectId must match prj_…" }, 400);
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw == null ? 40 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return jsonResponse({ error: "limit must be an integer 1–100" }, 400);
  }

  return { projectId, limit };
}

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const params = await ctx.params;
  return handleProxy(req, params.path ?? []);
}

async function handleProxy(req: Request, segments: string[]) {
  const bearer =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const expected = gatewayVercelAuthToken();
  if (!expected || !constantTimeEqual(bearer, expected)) {
    return unauthorized();
  }

  const relPath = segments.join("/");
  if (!isAllowedPath("GET", relPath)) {
    return jsonResponse({ error: "Not Found" }, 404);
  }

  const parsed = parseDeploymentsQuery(req);
  if (parsed instanceof Response) return parsed;

  const vercelToken = process.env.VERCEL_TOKEN?.trim();
  if (!vercelToken) {
    return jsonResponse({ error: "VERCEL_TOKEN is not configured on the gateway" }, 500);
  }

  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (teamId && !/^team_[a-zA-Z0-9]+$/.test(teamId)) {
    return jsonResponse({ error: "VERCEL_TEAM_ID on gateway must be team_…" }, 500);
  }

  const q = new URLSearchParams({
    projectId: parsed.projectId,
    limit: String(parsed.limit),
  });
  if (teamId) q.set("teamId", teamId);

  const upstreamUrl = `${VERCEL_ORIGIN}/${relPath}?${q}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${vercelToken}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return new Response(text || JSON.stringify({ error: "upstream error" }), {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    let data: { deployments?: RawDeployment[] };
    try {
      data = JSON.parse(text) as { deployments?: RawDeployment[] };
    } catch {
      return jsonResponse({ error: "Upstream returned invalid JSON" }, 502);
    }

    return jsonResponse({
      deployments: slimDeployments(Array.isArray(data.deployments) ? data.deployments : []),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "gateway upstream fetch failed";
    return jsonResponse({ error: "Gateway upstream error", message }, 502);
  }
}
