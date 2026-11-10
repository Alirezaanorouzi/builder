import { requireAdminSession } from "@/lib/admin-auth";
import { HttpError } from "@/lib/http-error";
import { listRecentUserMessages } from "@/services/product-analytics.service";

export const runtime = "nodejs";

function jsonError(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : "Server error";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    await requireAdminSession();
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 30);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const result = await listRecentUserMessages({ limit, offset });
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
