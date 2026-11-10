import { requireAdminSession } from "@/lib/admin-auth";
import { HttpError } from "@/lib/http-error";
import { listSitesByStatus } from "@/services/site-status.service";
import { serializeSiteForClient } from "@/lib/sites";
import type { SiteStatus } from "@prisma/client";

export const runtime = "nodejs";

const STATUSES: SiteStatus[] = ["provisioning", "active", "failed", "suspended"];

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
    const statusParam = url.searchParams.get("status") ?? "provisioning";
    const status = STATUSES.includes(statusParam as SiteStatus)
      ? (statusParam as SiteStatus)
      : "provisioning";
    const sites = await listSitesByStatus(status, 100);
    return Response.json({
      status,
      sites: sites.map((s) => ({
        ...serializeSiteForClient(s),
        userId: s.userId,
        ownerEmail: s.user.email,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
