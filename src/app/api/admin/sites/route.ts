import { jsonError, requireSessionUser } from "@/lib/access";
import { listSitesByStatus } from "@/services/site-status.service";
import { requireAdminUser } from "@/services/user.service";
import { serializeSiteForClient } from "@/lib/sites";
import type { SiteStatus } from "@prisma/client";

export const runtime = "nodejs";

const STATUSES: SiteStatus[] = ["provisioning", "active", "failed", "suspended"];

export async function GET(req: Request) {
  try {
    const session = await requireSessionUser();
    await requireAdminUser(session.id);
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
