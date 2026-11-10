import { jsonError, requireSessionUser } from "@/lib/access";
import { getPublicFeatureFlags } from "@/services/product-analytics.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSessionUser();
    const flags = await getPublicFeatureFlags();
    return Response.json({ flags });
  } catch (e) {
    return jsonError(e);
  }
}
