/** Client-ingested product analytics event names. */
export const PRODUCT_EVENT_NAMES = [
  "app_open",
  "preview_tab_open",
  "preview_external_open",
  "preview_link_copied",
  "preview_link_shared",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

const NAME_SET = new Set<string>(PRODUCT_EVENT_NAMES);

export function isProductEventName(name: string): name is ProductEventName {
  return NAME_SET.has(name);
}

export const SHARE_COPY_EVENTS: ProductEventName[] = [
  "preview_link_copied",
  "preview_link_shared",
];
