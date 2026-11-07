import { prisma } from "@/lib/db";
import { getConfig, getPlatformConfig } from "@/lib/config";
import { ensureInlineWorkerLoop, isInlineWorkerLoopRunning } from "@/lib/build-worker";
import { getWorkerConfig, isInlineBuildWorkerEnabled } from "@/lib/worker-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return "invalid";
  }
}

async function probe(url: string | undefined): Promise<{ reachable: boolean; status?: number; ms: number }> {
  const t0 = Date.now();
  if (!url) return { reachable: false, ms: 0 };
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000), cache: "no-store" });
    return { reachable: true, status: res.status, ms: Date.now() - t0 };
  } catch {
    return { reachable: false, ms: Date.now() - t0 };
  }
}

/**
 * Public, secret-free diagnostics: is the DB reachable, was the latest migration applied, and
 * which Cursor transport does THIS running process see. Never returns env values or error text.
 */
export async function GET() {
  ensureInlineWorkerLoop();
  const cfg = getConfig();

  let db: { ok: boolean; code?: string } = { ok: false };
  let buildEventSeq = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = { ok: true };
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'BuildEvent' AND column_name = 'seq'
    `;
    buildEventSeq = cols.length > 0;
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "unknown";
    db = { ok: false, code };
  }

  const gatewayOrigin = safeOrigin(cfg.engineGatewayUrl);
  const [gatewayProbe, vercelProbe] = await Promise.all([
    cfg.cursorTransport === "gateway" && gatewayOrigin && gatewayOrigin !== "invalid"
      ? probe(gatewayOrigin)
      : Promise.resolve(null),
    probe("https://api.vercel.com/"),
  ]);

  const platform = getPlatformConfig();
  const provisioningReady = Boolean(
    platform.githubToken &&
      platform.githubRepoOwner &&
      platform.templateOwner &&
      platform.templateRepo &&
      platform.vercelToken
  );
  const worker = getWorkerConfig();

  const cursorReady =
    cfg.cursorTransport === "gateway"
      ? Boolean(cfg.engineGatewayUrl && cfg.engineGatewayToken)
      : Boolean(cfg.cursorApiKey);

  const ok = db.ok && buildEventSeq && cursorReady && Boolean(cfg.vercelToken);

  return Response.json(
    {
      ok,
      db,
      migrations: { buildEventSeq },
      cursor: {
        transport: cfg.cursorTransport,
        ready: cursorReady,
        hasApiKey: Boolean(cfg.cursorApiKey),
        gatewayUrlSet: Boolean(cfg.engineGatewayUrl),
        gatewayTokenSet: Boolean(cfg.engineGatewayToken),
      },
      vercelTokenSet: Boolean(cfg.vercelToken),
      provisioningReady,
      reachability: { gateway: gatewayProbe, vercelApi: vercelProbe },
      worker: {
        inlineEnabled: isInlineBuildWorkerEnabled(),
        loopStarted: isInlineWorkerLoopRunning(),
        mode: worker.mode,
      },
      authUrl: safeOrigin(process.env.BETTER_AUTH_URL),
    },
    { status: ok ? 200 : 503 }
  );
}
