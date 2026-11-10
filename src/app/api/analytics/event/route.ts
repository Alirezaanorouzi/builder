import { jsonError, requireSessionUser } from "@/lib/access";
import { recordProductEvents } from "@/services/product-analytics.service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const user = await requireSessionUser();
    let body: {
      siteId?: string;
      events?: { name: string; props?: Record<string, unknown> }[];
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const events = body.events ?? [];
    if (!Array.isArray(events) || events.length === 0) {
      return Response.json({ error: "events required" }, { status: 400 });
    }
    const n = await recordProductEvents({
      userId: user.id,
      siteId: body.siteId,
      events,
    });
    return Response.json({ ok: true, recorded: n });
  } catch (e) {
    return jsonError(e);
  }
}
