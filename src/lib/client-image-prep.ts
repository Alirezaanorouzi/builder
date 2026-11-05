import {
  MAX_PROMPT_IMAGE_BYTES,
  resolveClientImageMime,
  resolvePromptImageMimeFromDataUrl,
} from "@/lib/prompt-images";

/** Max long edge for agent reference images — keeps JSON body small and send fast. */
const MAX_EDGE_PX = 2048;
const REENCODE_IF_LARGER_THAN_BYTES = 500 * 1024;
const JPEG_QUALITY = 0.85;

export type PreparedClientPromptImage = {
  mimeType: string;
  data: string;
  previewUrl: string;
  width?: number;
  height?: number;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

async function fileToPrepared(file: File, mimeType: string): Promise<PreparedClientPromptImage> {
  const previewUrl = await blobToDataUrl(file);
  return {
    mimeType,
    data: dataUrlToBase64(previewUrl),
    previewUrl,
  };
}

async function resizeViaCanvas(
  file: File,
  mimeType: string
): Promise<PreparedClientPromptImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height, 1));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const outMime =
    mimeType === "image/png" && file.size <= REENCODE_IF_LARGER_THAN_BYTES
      ? "image/png"
      : "image/jpeg";

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      resolve,
      outMime,
      outMime === "image/jpeg" ? JPEG_QUALITY : undefined
    );
  });
  if (!blob) return null;

  if (blob.size > MAX_PROMPT_IMAGE_BYTES) return null;

  const previewUrl = await blobToDataUrl(blob);
  const resolvedMime =
    resolvePromptImageMimeFromDataUrl(previewUrl) ?? outMime;

  return {
    mimeType: resolvedMime,
    data: dataUrlToBase64(previewUrl),
    previewUrl,
    width: targetW,
    height: targetH,
  };
}

/** Compress + encode once at pick time so send only posts a smaller JSON body. */
export async function prepareClientPromptImage(file: File): Promise<PreparedClientPromptImage> {
  const mimeType = resolveClientImageMime(file);
  if (!mimeType) {
    throw new Error("unsupported mime");
  }

  if (mimeType === "image/gif") {
    const prepared = await fileToPrepared(file, mimeType);
    if (estimateBase64Bytes(prepared.data) > MAX_PROMPT_IMAGE_BYTES) {
      throw new Error("too large");
    }
    return prepared;
  }

  const shouldCompress =
    file.size > REENCODE_IF_LARGER_THAN_BYTES || mimeType === "image/png";

  if (shouldCompress) {
    const resized = await resizeViaCanvas(file, mimeType);
    if (resized) return resized;
  }

  const prepared = await fileToPrepared(file, mimeType);
  if (estimateBase64Bytes(prepared.data) > MAX_PROMPT_IMAGE_BYTES) {
    const fallback = await resizeViaCanvas(file, mimeType);
    if (fallback) return fallback;
    throw new Error("too large");
  }
  return prepared;
}

function estimateBase64Bytes(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}
