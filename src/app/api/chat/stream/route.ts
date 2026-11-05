import { NextRequest } from "next/server";
import { assertServerConfig } from "@/lib/config";
import {
  assertBuildRunAccess,
  jsonError,
  requireSessionUser,
} from "@/lib/access";
import { prisma } from "@/lib/db";
import { withDbRetry } from "@/lib/db";
import { TERMINAL_BUILD_STATUSES } from "@/lib/build-runs";
import { buildStreamBus, streamEventToSse } from "@/lib/build-stream-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseEncode(event: string, data: unknown, id?: string): string {
  let chunk = "";
  if (id) chunk += `id: ${id}\n`;
  chunk += `event: ${event}\n`;
  chunk += `data: ${JSON.stringify(data)}\n\n`;
  return chunk;
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

    let unsubscribe = () => {};
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let doneSent = false;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const push = (sseEvent: string, data: Record<string, unknown>, id?: string) => {
          controller.enqueue(encoder.encode(sseEncode(sseEvent, data, id)));
        };

        const finish = (reason?: string) => {
          if (doneSent) return;
          doneSent = true;
          if (reason) {
            push("error", { eventId: `close-${Date.now()}`, message: reason });
          }
          unsubscribe();
          if (pollTimer) clearInterval(pollTimer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          setTimeout(() => buildStreamBus.drop(buildRunId), 10_000);
        };

        unsubscribe = buildStreamBus.subscribe(buildRunId, (ev) => {
          const { sseEvent, data } = streamEventToSse(ev);
          push(sseEvent, data, String(data.eventId ?? ev.id));
          if (ev.type === "done") finish();
        });

        pollTimer = setInterval(() => {
          void (async () => {
            if (doneSent) return;
            try {
              const run = await withDbRetry(() =>
                prisma.buildRun.findUnique({ where: { id: buildRunId } })
              );
              if (!run) {
                finish("Build run not found");
                return;
              }
              if (TERMINAL_BUILD_STATUSES.includes(run.status)) {
                push(
                  "done",
                  {
                    eventId: `run-terminal-${run.id}`,
                    status: run.status,
                    errorMessage: run.errorMessage ?? undefined,
                    startedAt: run.startedAt?.toISOString(),
                    finishedAt: (run.finishedAt ?? new Date()).toISOString(),
                  },
                  `run-terminal-${run.id}`
                );
                finish();
              }
            } catch (e) {
              push("error", {
                eventId: `poll-${Date.now()}`,
                message: e instanceof Error ? e.message : "Stream poll error",
              });
            }
          })();
        }, 2000);
      },
      cancel() {
        unsubscribe();
        if (pollTimer) clearInterval(pollTimer);
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
