import { requireAdminSession } from "@/lib/admin-auth";
import { HttpError } from "@/lib/http-error";
import { listFeatureFlags, setFeatureFlag } from "@/services/product-analytics.service";

export const runtime = "nodejs";

function jsonError(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : "Server error";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdminSession();
    const flags = await listFeatureFlags();
    return Response.json({ flags });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdminSession();
    const body = (await req.json()) as { key?: string; enabled?: boolean };
    if (!body.key || typeof body.enabled !== "boolean") {
      return Response.json({ error: "key and enabled required" }, { status: 400 });
    }
    const flag = await setFeatureFlag(body.key, body.enabled);
    return Response.json({ flag });
  } catch (e) {
    return jsonError(e);
  }
}
