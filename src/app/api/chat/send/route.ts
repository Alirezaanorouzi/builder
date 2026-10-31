import { NextRequest } from "next/server";
import { assertServerConfig } from "@/lib/config";
import { getCodingEngine } from "@engines/index";
import { wrapUserPrompt } from "@/lib/prompts";
import { getOrCreateSession, setSessionAgentId } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertServerConfig();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Configuration error";
    return Response.json({ error: message }, { status: 500 });
  }

  let body: { message?: string; sessionId?: string };
  try {
    body = (await req.json()) as { message?: string; sessionId?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const session = getOrCreateSession(body.sessionId);
  const promptText = wrapUserPrompt(message);
  const startedAt = Date.now();
  const engine = getCodingEngine();

  try {
    const { agentId, runId } = await engine.startRun({
      promptText,
      agentId: session.agentId,
    });

    if (session.agentId !== agentId) {
      setSessionAgentId(session.id, agentId);
    }

    return Response.json({
      sessionId: session.id,
      agentId,
      runId,
      startedAt,
      engine: engine.id,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Failed to start agent";
    if (errMsg.includes("409") || errMsg.toLowerCase().includes("busy")) {
      return Response.json(
        { error: "Agent is still working. Wait for the current task to finish." },
        { status: 409 }
      );
    }
    return Response.json({ error: errMsg }, { status: 502 });
  }
}
