/** Customer support links (telegram is public; phone is passed from the server). */
export const SUPPORT_TELEGRAM_GROUP_URL = "https://t.me/+WsUMm76hSOo4MDQ0";

/** Build a `tel:` href from Liara/local `PHONE_NUMBER_DEVELOPER`. */
export function developerPhoneCallHref(phoneRaw: string | undefined | null): string | null {
  const trimmed = phoneRaw?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d+]/g, "");
  if (!normalized) return null;
  return `tel:${normalized}`;
}
