import { assertSiteAccess, jsonError, requireSessionUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { enqueueSiteProvisioning } from "@/lib/provisioning/runner";
import { serializeSiteForClient } from "@/lib/sites";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    await assertSiteAccess(user.id, id);

    await prisma.site.update({
      where: { id },
      data: { status: "provisioning", updatedAt: new Date() },
    });
    await prisma.siteResources.update({
      where: { siteId: id },
      data: { provisioningError: null },
    });

    enqueueSiteProvisioning(id);

    const site = await assertSiteAccess(user.id, id);
    return Response.json({ site: serializeSiteForClient(site) });
  } catch (e) {
    return jsonError(e);
  }
}
