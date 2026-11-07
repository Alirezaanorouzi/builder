/** Shared fetch for GitHub/Vercel from Liara — undici defaults ~10s connect; routes can be flaky. */
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
      return await fetch(href, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      last = e;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  const detail =
    last && typeof last === "object" && "cause" in last && (last as { cause?: unknown }).cause
      ? String((last as { cause: unknown }).cause)
      : last instanceof Error
        ? last.message
        : String(last);
  throw new Error(
    `Platform HTTP failed after ${retries} tries (${href}): ${detail}. ` +
      `If timeouts persist from Liara to api.vercel.com, provisioning needs a Vercel-region proxy (like the Cursor gateway).`
  );
}
