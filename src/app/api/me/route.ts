import { requireSessionUser, jsonError } from "@/lib/access";
import { ensureInlineWorkerLoop, kickInlineWorkerTick } from "@/lib/build-worker";
import { ensureDefaultSite, listSitesForUser, serializeSiteForClient } from "@/lib/sites";
import { getPlatformUser } from "@/services/user.service";

export const runtime = "nodejs";

/**
 * Cheap, DB-only endpoint (called often by the client). It must not call GitHub or Vercel:
 * the preview gate is advanced by the worker when a deployment is confirmed READY, and legacy
 * sites are backfilled once with `npm run backfill:preview-gate`.
 */
export async function GET() {
  try {
    const session = await requireSessionUser();
    const profile = await getPlatformUser(session.id);
    await ensureDefaultSite(session.id);
    ensureInlineWorkerLoop();
    kickInlineWorkerTick();
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
