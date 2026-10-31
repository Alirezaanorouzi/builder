import { assertSiteAccess, jsonError, requireSessionUser } from "@/lib/access";
import { serializeSiteForClient } from "@/lib/sites";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const site = await assertSiteAccess(user.id, id);
    return Response.json({ site: serializeSiteForClient(site) });
  } catch (e) {
    return jsonError(e);
  }
}
