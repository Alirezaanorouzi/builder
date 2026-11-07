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
import { readBuildEventsAfter, streamEventToSse } from "@/lib/build-stream-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often the route checks Postgres for new `BuildEvent` rows. */
const TAIL_INTERVAL_MS = 1000;
/** Keep-alive comment so proxies do not close an idle stream. */
const PING_INTERVAL_MS = 15_000;
/**
 * If the run is terminal but no `done` event ever shows up (worker died right after finishing),
 * synthesize one after this grace period.
 */
const TERMINAL_GRACE_MS = 4000;

function sseEncode(event: string, data: unknown, id?: string): string {
  let chunk = "";
  if (id) chunk += `id: ${id}\n`;
  chunk += `event: ${event}\n`;
  chunk += `data: ${JSON.stringify(data)}\n\n`;
  return chunk;
}

function parseLastSeq(req: NextRequest): bigint {
  const raw =
    req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("lastEventId") ?? "";
  return /^\d+$/.test(raw) ? BigInt(raw) : BigInt(0);
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

    let tailTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let lastSeq = parseLastSeq(req);

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const cleanup = () => {
          closed = true;
          if (tailTimer) clearTimeout(tailTimer);
          if (pingTimer) clearInterval(pingTimer);
        };

        const push = (sseEvent: string, data: Record<string, unknown>, id?: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(sseEncode(sseEvent, data, id)));
          } catch {
            finish();
          }
        };

        const finish = (reason?: string) => {
          if (closed) return;
          if (reason) {
            push("error", { eventId: `close-${Date.now()}`, message: reason });
          }
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        pingTimer = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            finish();
          }
        }, PING_INTERVAL_MS);

        let terminalSeenAt: number | null = null;

        const tick = async () => {
          if (closed) return;
          try {
            const { events, lastSeq: nextSeq } = await withDbRetry(() =>
              readBuildEventsAfter(buildRunId, lastSeq)
            );
            lastSeq = nextSeq;

            for (const ev of events) {
              const { sseEvent, data } = streamEventToSse(ev);
              push(sseEvent, data, ev.id);
              if (ev.type === "done") {
                finish();
                return;
              }
            }

            if (events.length === 0) {
              const run = await withDbRetry(() =>
                prisma.buildRun.findUnique({ where: { id: buildRunId } })
              );
              if (!run) {
                finish("Build run not found");
                return;
              }
              if (TERMINAL_BUILD_STATUSES.includes(run.status)) {
                terminalSeenAt ??= Date.now();
                if (Date.now() - terminalSeenAt >= TERMINAL_GRACE_MS) {
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
                  return;
                }
              }
            } else {
              terminalSeenAt = null;
            }
          } catch (e) {
            if (closed) return;
            push("error", {
              eventId: `tail-${Date.now()}`,
              message: e instanceof Error ? e.message : "Stream error",
            });
            finish();
            return;
          }
          if (!closed) tailTimer = setTimeout(() => void tick(), TAIL_INTERVAL_MS);
        };

        void tick();
      },
      cancel() {
        closed = true;
        if (tailTimer) clearTimeout(tailTimer);
        if (pingTimer) clearInterval(pingTimer);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
