import { assertSiteAccess, jsonError, requireSessionUser } from "@/lib/access";
import { buildChatHistory } from "@/lib/chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireSessionUser();
    const url = new URL(req.url);
    const siteId = url.searchParams.get("siteId")?.trim();
    if (!siteId) {
      return Response.json({ error: "siteId is required" }, { status: 400 });
    }
    await assertSiteAccess(user.id, siteId);
    const chatSessionId = url.searchParams.get("chatSessionId");
    const history = await buildChatHistory(siteId, chatSessionId);
    if (!history) {
      return Response.json({ chatSessionId: null, turns: [], items: [], activeBuildRunId: null });
    }
    return Response.json(history);
  } catch (e) {
    return jsonError(e);
  }
}
