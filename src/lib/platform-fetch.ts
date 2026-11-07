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
