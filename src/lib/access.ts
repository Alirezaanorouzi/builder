import { headers } from "next/headers";
import { auth, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function requireSessionUser(): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id || !session.user.email) {
    throw new HttpError("Unauthorized", 401);
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? session.user.email,
  };
}

export async function assertSiteAccess(userId: string, siteId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId },
    include: { resources: true },
  });
  if (!site) {
    throw new HttpError("Site not found", 404);
  }
  return site;
}

export async function assertChatSessionAccess(userId: string, chatSessionId: string) {
  const session = await prisma.chatSession.findFirst({
    where: { id: chatSessionId, site: { userId } },
    include: { site: { include: { resources: true } } },
  });
  if (!session) {
    throw new HttpError("Chat session not found", 404);
  }
  return session;
}

export async function assertBuildRunAccess(userId: string, buildRunId: string) {
  const run = await prisma.buildRun.findFirst({
    where: { id: buildRunId, site: { userId } },
    include: {
      site: { include: { resources: true } },
      chatSession: true,
    },
  });
  if (!run) {
    throw new HttpError("Build run not found", 404);
  }
  return run;
}

import { SiteNotReadyError } from "@/lib/site-runtime";

export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof SiteNotReadyError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : "Server error";
  return Response.json({ error: message }, { status: 500 });
}
