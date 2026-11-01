import { handleChatSend } from "@/lib/chat-send";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/** Guide alias: same handler as POST /api/chat/send with siteId from the path. */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: siteId } = await context.params;
  return handleChatSend(req, { siteId });
}
