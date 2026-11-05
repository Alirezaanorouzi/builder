import { requireSessionUser, jsonError } from "@/lib/access";
import { kickInlineWorkerTick } from "@/lib/build-worker";
import { ensureDefaultSite, listSitesForUser, serializeSiteForClient } from "@/lib/sites";
import { ensurePreviewGateFields } from "@/services/preview-commit.service";
import { getPlatformUser } from "@/services/user.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSessionUser();
    const profile = await getPlatformUser(session.id);
    await ensureDefaultSite(session.id);
    kickInlineWorkerTick();
    let sites = await listSitesForUser(session.id);
    for (const s of sites) {
      await ensurePreviewGateFields(s);
    }
    sites = await listSitesForUser(session.id);
    return Response.json({
      user: {
        id: session.id,
        email: session.email,
        name: session.name,
        role: profile?.role ?? "user",
        accountStatus: profile?.accountStatus ?? "active",
      },
      sites: sites.map(serializeSiteForClient),
    });
  } catch (e) {
    return jsonError(e);
  }
}
