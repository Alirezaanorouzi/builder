import { assertSiteAccess, jsonError, requireSessionUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { kickInlineWorkerTick } from "@/lib/build-worker";
import { serializeSiteForClient } from "@/lib/sites";
import { transitionSiteStatus } from "@/services/site-status.service";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    await assertSiteAccess(user.id, id);

    await transitionSiteStatus(id, "provisioning", { message: "Manual provisioning retry" });
    await prisma.siteResources.update({
      where: { siteId: id },
      data: {
        provisioningError: null,
        provisioningLeaseUntil: null,
        provisioningWorkerId: null,
      },
    });

    kickInlineWorkerTick();

    const site = await assertSiteAccess(user.id, id);
    return Response.json({ site: serializeSiteForClient(site) });
  } catch (e) {
    return jsonError(e);
  }
}
