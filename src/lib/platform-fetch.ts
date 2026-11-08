import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

/** Long-lived connections for Liara → GitHub/Vercel (poll interval exceeds undici default keep-alive). */
const platformDispatcher = new Agent({
  connectTimeout: 30_000,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 60_000,
});

export class PlatformHttpError extends Error {
  readonly href: string;
  readonly attempts: number;

  constructor(href: string, attempts: number, cause: unknown) {
    super(`Platform HTTP failed after ${attempts} tries: ${href}`);
    this.name = "PlatformHttpError";
    this.href = href;
    this.attempts = attempts;
    this.cause = cause;
  }
}

function backoffMs(attempt: number): number {
  const base = 1_500 * (attempt + 1);
  const jitter = Math.floor(Math.random() * 800);
  return base + jitter;
}

/** Shared fetch for GitHub/Vercel from Liara — tuned connect + keep-alive; retries with jitter. */
export async function platformFetch(
  url: string | URL,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number }
): Promise<Response> {
  const retries = Math.max(1, options?.retries ?? 4);
  const timeoutMs = Math.max(5_000, options?.timeoutMs ?? 45_000);
  let last: unknown;
  const href = typeof url === "string" ? url : url.href;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await undiciFetch(href, {
        ...init,
        dispatcher: platformDispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      } as UndiciRequestInit);
      return res as unknown as Response;
    } catch (e) {
      last = e;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      }
    }
  }

  const err = new PlatformHttpError(href, retries, last);
  console.error("[platform-fetch]", err.message, last);
  throw err;
}

export type HedgedGetSpec = { url: string; init?: RequestInit };

function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const ctrl = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      ctrl.abort();
      return ctrl.signal;
    }
    sig.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

/**
 * Idempotent GET: two parallel attempts (second after hedgeMs).
 * Losers are aborted once a winner settles; the winner body is buffered first so abort
 * cannot break later `res.json()` on the returned Response.
 */
export async function hedgedPlatformGet(
  primary: HedgedGetSpec,
  secondary: HedgedGetSpec | null,
  options?: { hedgeMs?: number; timeoutMs?: number }
): Promise<Response> {
  const hedgeMs = options?.hedgeMs ?? 4_000;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const controllers: AbortController[] = [];

  const singleAttempt = async (spec: HedgedGetSpec, userAbort: AbortSignal): Promise<Response> => {
    const href = spec.url;
    const res = await undiciFetch(href, {
      ...spec.init,
      dispatcher: platformDispatcher,
      signal: mergeAbortSignals(userAbort, AbortSignal.timeout(timeoutMs)),
    } as UndiciRequestInit);
    const r = res as unknown as Response;
    if (r.status >= 500 || r.status === 429) {
      throw new Error(`HTTP ${r.status} ${href}`);
    }
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") ?? "application/json" },
    });
  };

  const delayedAttempt = (spec: HedgedGetSpec, delayMs: number): Promise<Response> =>
    new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const timer = setTimeout(() => {
        if (ctrl.signal.aborted) return;
        void singleAttempt(spec, ctrl.signal).then(resolve, reject);
      }, delayMs);
      ctrl.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });

  const immediateAttempt = (spec: HedgedGetSpec): Promise<Response> => {
    const ctrl = new AbortController();
    controllers.push(ctrl);
    return singleAttempt(spec, ctrl.signal);
  };

  const racers: Promise<Response>[] = [immediateAttempt(primary)];
  if (secondary) racers.push(delayedAttempt(secondary, hedgeMs));

  try {
    const winner = await Promise.any(racers);
    for (const c of controllers) c.abort();
    return winner;
  } catch (e) {
    for (const c of controllers) c.abort();
    throw new PlatformHttpError(primary.url, racers.length, e);
  }
}
