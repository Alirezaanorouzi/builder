import { NextRequest } from "next/server";
import { assertServerConfig } from "@/lib/config";
import {
  assertBuildRunAccess,
  jsonError,
  requireSessionUser,
} from "@/lib/access";
import { prisma } from "@/lib/db";
import {
  listBuildEventsSince,
  TERMINAL_BUILD_STATUSES,
} from "@/lib/build-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sseEncode(event: string, data: unknown, id?: string): string {
  let chunk = "";
  if (id) chunk += `id: ${id}\n`;
  chunk += `event: ${event}\n`;
  chunk += `data: ${JSON.stringify(data)}\n\n`;
  return chunk;
}

function pushEventFromRow(
  push: (event: string, data: unknown) => void,
  row: { eventType: string; message: string | null; payload: unknown }
) {
  const type = row.eventType;
  if (type === "assistant") {
    const payload = row.payload as { text?: string } | null;
    push("assistant", { text: payload?.text ?? row.message ?? "" });
    return;
  }
  if (type === "preview") {
    const payload = row.payload as { url?: string } | null;
    if (payload?.url) push("preview", { url: payload.url });
    return;
  }
  if (type === "done") {
    push("done", {});
    return;
  }
  if (type === "error") {
    push("error", { message: row.message ?? "Error" });
    return;
  }
  if (type === "status" || type === "activity") {
    push(type, { message: row.message ?? "" });
    return;
  }
  push("status", { message: row.message ?? type });
}

export async function GET(req: NextRequest) {
  try {
    assertServerConfig();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Configuration error";
    return new Response(message, { status: 500 });
  }

  const buildRunId = req.nextUrl.searchParams.get("buildRunId");
  if (!buildRunId) {
    return new Response("buildRunId is required", { status: 400 });
  }

  try {
    const user = await requireSessionUser();
    await assertBuildRunAccess(user.id, buildRunId);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const push = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(sseEncode(event, data)));
        };

        let lastCreatedAt: Date | undefined;
        let terminal = false;

        try {
          for (;;) {
            const events = await listBuildEventsSince(buildRunId, lastCreatedAt);
            for (const row of events) {
              pushEventFromRow(push, row);
              lastCreatedAt = row.createdAt;
              if (row.eventType === "done") terminal = true;
            }

            const run = await prisma.buildRun.findUnique({
              where: { id: buildRunId },
            });
            if (!run) break;

            if (
              TERMINAL_BUILD_STATUSES.includes(run.status) &&
              (terminal || events.some((e) => e.eventType === "done"))
            ) {
              if (!terminal) push("done", {});
              break;
            }

            if (terminal) break;

            await sleep(800);
          }
        } catch (e) {
          push("error", {
            message: e instanceof Error ? e.message : "Stream error",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
