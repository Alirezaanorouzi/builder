import { prisma } from "@/lib/db";
import { parseStoredPromptImages } from "@/lib/prompt-images";
import { ACTIVE_BUILD_STATUSES } from "@/lib/build-runs";
import { buildChatItemsForRun, type ChatReplayItem } from "@/lib/chat-replay";
import type { BuildRunStatus } from "@prisma/client";

export type ChatHistoryTurn = {
  buildRunId: string;
  userMessage: string;
  imageCount: number;
  assistantText: string;
  status: BuildRunStatus;
  chatSessionId: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export async function resolveChatSessionForHistory(
  siteId: string,
  chatSessionId?: string | null
): Promise<{ id: string } | null> {
  if (chatSessionId) {
    const s = await prisma.chatSession.findFirst({
      where: { id: chatSessionId, siteId },
      select: { id: true },
    });
    if (s) return s;
  }
  return prisma.chatSession.findFirst({
    where: { siteId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
}

export async function buildChatHistory(
  siteId: string,
  chatSessionId?: string | null
): Promise<{
  chatSessionId: string;
  turns: ChatHistoryTurn[];
  items: ChatReplayItem[];
  activeBuildRunId: string | null;
} | null> {
  const session = await resolveChatSessionForHistory(siteId, chatSessionId);
  if (!session) return null;

  const runs = await prisma.buildRun.findMany({
    where: { siteId, chatSessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  const turns: ChatHistoryTurn[] = [];
  const items: ChatReplayItem[] = [];
  for (const run of runs) {
    const images = parseStoredPromptImages(run.promptImages);
    const runItems = await buildChatItemsForRun(run);
    items.push(...runItems);
    const assistantText =
      runItems
        .filter((i): i is Extract<ChatReplayItem, { kind: "assistant" }> => i.kind === "assistant")
        .map((i) => i.text)
        .join("\n")
        .trim() || "";
    turns.push({
      buildRunId: run.id,
      userMessage: run.userMessage,
      imageCount: images.length,
      assistantText,
      status: run.status,
      chatSessionId: session.id,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    });
  }

  const active = runs.find((r) => ACTIVE_BUILD_STATUSES.includes(r.status));
  return {
    chatSessionId: session.id,
    turns,
    items,
    activeBuildRunId: active?.id ?? null,
  };
}
