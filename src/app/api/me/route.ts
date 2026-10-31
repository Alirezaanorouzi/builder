import { requireSessionUser, jsonError } from "@/lib/access";
import { ensureDefaultSite, listSitesForUser, serializeSiteForClient } from "@/lib/sites";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSessionUser();
    await ensureDefaultSite(user.id);
    const sites = await listSitesForUser(user.id);
    return Response.json({
      user: { id: user.id, email: user.email, name: user.name },
      sites: sites.map(serializeSiteForClient),
    });
  } catch (e) {
    return jsonError(e);
  }
}
