import { requireAdminSession } from "@/lib/admin-auth";
import { HttpError } from "@/lib/http-error";
import { getMetricsOverview } from "@/services/product-analytics.service";

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
    const overview = await getMetricsOverview();
    return Response.json(overview);
  } catch (e) {
    return jsonError(e);
  }
}
