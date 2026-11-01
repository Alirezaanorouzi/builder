import { NextRequest } from "next/server";
import { handleChatSend } from "@/lib/chat-send";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleChatSend(req);
}
