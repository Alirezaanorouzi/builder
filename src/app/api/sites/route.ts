import { assertSiteAccess, jsonError, requireSessionUser } from "@/lib/access";
import { createUserSite, listSitesForUser, serializeSiteForClient } from "@/lib/sites";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const sites = await listSitesForUser(user.id);
    return Response.json({ sites: sites.map(serializeSiteForClient) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSessionUser();
    let body: { displayName?: string; slug?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const displayName = body.displayName?.trim() || "My website";
    const site = await createUserSite(user.id, displayName, body.slug?.trim());
    return Response.json({ site: serializeSiteForClient(site) }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
