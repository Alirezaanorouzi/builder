import type { ProductEventName } from "@/lib/product-events";

const throttleMs: Partial<Record<ProductEventName, number>> = {
  preview_tab_open: 800,
  app_open: 60_000,
};

const lastSent = new Map<string, number>();

export function trackProductEvent(
  name: ProductEventName,
  props?: Record<string, unknown>
) {
  if (typeof window === "undefined") return;
  const key = `${name}:${props?.siteId ?? ""}`;
  const wait = throttleMs[name] ?? 0;
  const now = Date.now();
  const prev = lastSent.get(key) ?? 0;
  if (wait > 0 && now - prev < wait) return;
  lastSent.set(key, now);

  void fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      events: [{ name, props }],
    }),
    keepalive: true,
  }).catch(() => {
    /* analytics must not break UX */
  });
}

export function trackAppOpenOnce(siteId?: string) {
  if (typeof window === "undefined") return;
  const guard = "builder_app_open_tracked";
  if (sessionStorage.getItem(guard)) return;
  sessionStorage.setItem(guard, "1");
  trackProductEvent("app_open", siteId ? { siteId } : undefined);
}
