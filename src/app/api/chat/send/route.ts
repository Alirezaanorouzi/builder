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
  appendBuildEvent,
} from "@/lib/build-runs";
import {
  ensureDefaultSite,
  getOrCreateChatSession,
} from "@/lib/sites";
import { processOneBuildJob } from "@/lib/build-worker";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertServerConfig();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Configuration error";
    return Response.json({ error: message }, { status: 500 });
  }

  let body: { message?: string; siteId?: string; chatSessionId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const user = await requireSessionUser();

    let siteId = body.siteId;
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
      userMessage: message,
    });

    await appendBuildEvent(buildRun.id, "status", {
      message: "Build queued…",
    });

    if (process.env.INLINE_BUILD_WORKER === "1") {
      void processOneBuildJob();
    }

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
