import { NextRequest } from "next/server";
import { assertServerConfig } from "@/lib/config";
import { getCodingEngine } from "@engines/index";
import { getSession } from "@/lib/store";
import { waitForPreviewUrl } from "@/lib/vercel";
import type { EngineStreamEvent } from "@engines/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseEncode(event: string, data: unknown, id?: string): string {
  let chunk = "";
  if (id) chunk += `id: ${id}\n`;
  chunk += `event: ${event}\n`;
  chunk += `data: ${JSON.stringify(data)}\n\n`;
  return chunk;
}

function mapEngineEvent(event: EngineStreamEvent): { name: string; data: unknown } {
  switch (event.type) {
    case "status":
      return { name: "status", data: { message: event.message } };
    case "assistant":
      return { name: "assistant", data: { text: event.text } };
    case "activity":
      return { name: "activity", data: { message: event.message } };
    case "error":
      return { name: "error", data: { message: event.message } };
  }
}

export async function GET(req: NextRequest) {
  try {
    assertServerConfig();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Configuration error";
    return new Response(message, { status: 500 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const runId = req.nextUrl.searchParams.get("runId");
  const startedAtParam = req.nextUrl.searchParams.get("startedAt");
  const startedAt = startedAtParam ? Number(startedAtParam) : Date.now();

  if (!sessionId || !runId) {
    return new Response("sessionId and runId are required", { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session?.agentId) {
    return new Response("Unknown session", { status: 404 });
  }

  const engine = getCodingEngine();
  const agentId = session.agentId;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEncode(event, data)));
      };

      try {
        const result = await engine.streamRun(agentId, runId, startedAt, (ev) => {
          const mapped = mapEngineEvent(ev);
          push(mapped.name, mapped.data);
        });

        if (result.requestPreview) {
          try {
            const preview = await waitForPreviewUrl({ sinceMs: startedAt });
            if (preview.note) {
              push("status", { message: preview.note });
            }
            if (preview.url) {
              push("preview", { url: preview.url });
            } else {
              push("status", {
                message:
                  "Build finished but no new Vercel deployment yet. Check Vercel dashboard or retry in a minute.",
              });
            }
          } catch (e) {
            push("error", {
              message: e instanceof Error ? e.message : "Failed to fetch Vercel URL",
            });
          }
        }

        push("done", {});
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
}
