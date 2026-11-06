import type { EnginePromptImage } from "@engines/types";

/** Cursor Cloud Agents: max 5 images, 15 MB each (API v1). */
export const MAX_PROMPT_IMAGES = 5;
export const MAX_PROMPT_IMAGE_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Normalize browser-reported MIME (e.g. image/jpg → image/jpeg). */
export function normalizePromptImageMime(mime: string): string {
  const m = mime.trim().toLowerCase();
  if (m === "image/jpg" || m === "image/pjpeg") return "image/jpeg";
  return m;
}

/** Resolve MIME for a picked File (Windows often leaves `type` empty). */
export function resolveClientImageMime(file: Pick<File, "name" | "type">): string | null {
  const fromType = file.type?.trim();
  if (fromType) {
    const normalized = normalizePromptImageMime(fromType);
    if (ALLOWED_MIME.has(normalized)) return normalized;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const fromExt = EXT_TO_MIME[ext];
  if (fromExt) return fromExt;
  return null;
}

/** Fallback when `File.type` is empty — FileReader still embeds MIME in the data URL. */
export function resolvePromptImageMimeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]+)/i.exec(dataUrl.trim());
  if (!match) return null;
  const normalized = normalizePromptImageMime(match[1] ?? "");
  return ALLOWED_MIME.has(normalized) ? normalized : null;
}

export type StoredPromptImage = {
  data: string;
  mimeType: string;
  dimension?: { width: number; height: number };
};

export type ClientPromptImageInput = {
  data?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  name?: string;
};

function stripDataUrlPrefix(data: string): string {
  const trimmed = data.trim();
  const comma = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && comma !== -1) {
    return trimmed.slice(comma + 1).replace(/\s/g, "");
  }
  return trimmed.replace(/\s/g, "");
}

function estimateBase64Bytes(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

/** Validate client JSON and normalize for SDK / DB storage. */
export function parsePromptImagesFromClient(raw: unknown): StoredPromptImage[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("images must be an array");
  }
  if (raw.length > MAX_PROMPT_IMAGES) {
    throw new Error(`حداکثر ${MAX_PROMPT_IMAGES} تصویر در هر پیام`);
  }

  const out: StoredPromptImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid image entry");
    }
    const row = item as ClientPromptImageInput;
    const mimeType = normalizePromptImageMime(row.mimeType?.trim() ?? "");
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new Error("Only PNG, JPEG, GIF, and WebP images are supported");
    }
    const data = stripDataUrlPrefix(String(row.data ?? ""));
    if (!data) {
      throw new Error("Image data is missing");
    }
    const bytes = estimateBase64Bytes(data);
    if (bytes > MAX_PROMPT_IMAGE_BYTES) {
      throw new Error("Each image must be 15 MB or smaller");
    }
    const image: StoredPromptImage = { data, mimeType };
    if (typeof row.width === "number" && typeof row.height === "number") {
      image.dimension = { width: Math.round(row.width), height: Math.round(row.height) };
    }
    out.push(image);
  }
  return out;
}

export function storedImagesToSdk(images: StoredPromptImage[] | null | undefined): EnginePromptImage[] {
  if (!images?.length) return [];
  return images.map((img) => {
    const base: EnginePromptImage = { data: img.data, mimeType: img.mimeType };
    if (img.dimension) {
      return { ...base, dimension: img.dimension };
    }
    return base;
  });
}

export function parseStoredPromptImages(raw: unknown): StoredPromptImage[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is StoredPromptImage =>
      Boolean(x) &&
      typeof x === "object" &&
      typeof (x as StoredPromptImage).data === "string" &&
      typeof (x as StoredPromptImage).mimeType === "string"
  );
}
