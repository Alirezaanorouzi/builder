import { requireSessionUser, jsonError } from "@/lib/access";
import { processOneWorkerTick } from "@/lib/build-worker";
import { ensureDefaultSite, listSitesForUser, serializeSiteForClient } from "@/lib/sites";
import { getPlatformUser } from "@/services/user.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSessionUser();
    const profile = await getPlatformUser(session.id);
    await ensureDefaultSite(session.id);
    if (process.env.INLINE_BUILD_WORKER === "1") {
      void processOneWorkerTick();
    }
    const sites = await listSitesForUser(session.id);
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
