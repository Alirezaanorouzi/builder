import { NextRequest } from "next/server";
import { assertServerConfig } from "@/lib/config";
import {
  assertChatSessionAccess,
  assertSiteAccess,
  HttpError,
  jsonError,
  requireSessionUser,
} from "@/lib/access";
import {
  assertSiteReadyForBuild,
  SiteNotReadyError,
} from "@/lib/site-runtime";
import {
  createQueuedBuildRun,
} from "@/lib/build-runs";
import {
  ensureDefaultSite,
  getOrCreateChatSession,
} from "@/lib/sites";
import {
  parsePromptImagesFromClient,
  type StoredPromptImage,
} from "@/lib/prompt-images";
import { kickInlineWorkerTick } from "@/lib/build-worker";

export async function handleChatSend(
  req: NextRequest,
  options?: { siteId?: string }
) {
  try {
    assertServerConfig();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Configuration error";
    return Response.json({ error: message }, { status: 500 });
  }

  let body: {
    message?: string;
    siteId?: string;
    chatSessionId?: string;
    images?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim() ?? "";
  let promptImages: StoredPromptImage[] = [];
  try {
    promptImages = parsePromptImagesFromClient(body.images);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid images";
    return Response.json({ error: msg }, { status: 400 });
  }
  if (!message && promptImages.length === 0) {
    return Response.json({ error: "message or images required" }, { status: 400 });
  }

  try {
    const user = await requireSessionUser();

    let siteId = options?.siteId ?? body.siteId;
    if (!siteId) {
      const defaultSite = await ensureDefaultSite(user.id);
      siteId = defaultSite.id;
    }

    const site = await assertSiteAccess(user.id, siteId);
    assertSiteReadyForBuild(site);

    const chatSession = await getOrCreateChatSession(siteId, body.chatSessionId);
    await assertChatSessionAccess(user.id, chatSession.id);

    const buildRun = await createQueuedBuildRun({
      siteId,
      chatSessionId: chatSession.id,
      userMessage:
        message ||
        "Use the attached reference image(s) when updating the website.",
      promptImages,
    });

    kickInlineWorkerTick();

    return Response.json({
      siteId,
      chatSessionId: chatSession.id,
      buildRunId: buildRun.id,
      status: buildRun.status,
    });
  } catch (e) {
    if (e instanceof HttpError || e instanceof SiteNotReadyError) {
      return jsonError(e);
    }
    const errMsg = e instanceof Error ? e.message : "Failed to queue build";
    return Response.json({ error: errMsg }, { status: 502 });
  }
}
