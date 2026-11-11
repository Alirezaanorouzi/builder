import { requireSessionUser, jsonError } from "@/lib/access";
import { ensureInlineWorkerLoop, kickInlineWorkerTick } from "@/lib/build-worker";
import { ensureDefaultSite, listSitesForUser, serializeSiteForClient } from "@/lib/sites";
import { getPlatformUser } from "@/services/user.service";
import { getUsageView } from "@/services/quota.service";
import { provisionDebugLog } from "@/lib/provision-debug-log";

export const runtime = "nodejs";

/**
 * Cheap, DB-only endpoint (called often by the client). It must not call GitHub or Vercel:
 * the preview gate is advanced by the worker when a deployment is confirmed READY, and legacy
 * sites are backfilled once with `npm run backfill:preview-gate`.
 */
export async function GET() {
  try {
    const meT0 = Date.now();
    const session = await requireSessionUser();
    const profile = await getPlatformUser(session.id);
    const ensureT0 = Date.now();
    await ensureDefaultSite(session.id);
    const ensureMs = Date.now() - ensureT0;
    ensureInlineWorkerLoop();
    kickInlineWorkerTick();
    const sites = await listSitesForUser(session.id);
    const primary = sites[0];
    provisionDebugLog("E,F", "api/me/route.ts:GET", "/api/me", {
      ensureMs,
      totalMs: Date.now() - meT0,
      siteStatus: primary?.status ?? null,
      provisioningStep: primary?.resources?.provisioningStep ?? null,
      siteCount: sites.length,
    });
    const usage = await getUsageView(session.id);
    return Response.json({
      user: {
        id: session.id,
        email: session.email,
        name: session.name,
        role: profile?.role ?? "user",
        accountStatus: profile?.accountStatus ?? "active",
      },
      sites: sites.map(serializeSiteForClient),
      usage,
    });
  } catch (e) {
    return jsonError(e);
  }
}
