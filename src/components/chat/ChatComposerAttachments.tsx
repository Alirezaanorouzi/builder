"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  MAX_PROMPT_IMAGES,
  MAX_PROMPT_IMAGE_BYTES,
  resolveClientImageMime,
  resolvePromptImageMimeFromDataUrl,
} from "@/lib/prompt-images";

export type PendingChatImage = {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  data: string;
  width?: number;
  height?: number;
};

const ACCEPT = "image/png,image/jpeg,image/jpg,image/gif,image/webp,image/*";

/** Read file as a data URL via arrayBuffer (more reliable than FileReader on some browsers). */
async function readFileAsDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  const hinted =
    resolveClientImageMime(file) ??
    resolvePromptImageMimeFromDataUrl(`data:image/jpeg;base64,${base64}`) ??
    "image/jpeg";
  return `data:${hinted};base64,${base64}`;
}

function ComposerPaperclipIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function useChatAttachments(onError: (message: string) => void, disabled?: boolean) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingChatImage[]>([]);
  const [processingFiles, setProcessingFiles] = useState(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const inputPickDisabled =
    Boolean(disabled) || pending.length >= MAX_PROMPT_IMAGES;
  const attachButtonDisabled = inputPickDisabled || processingFiles > 0;

  const onPickFiles = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList?.length) return;

      const picked = Array.from(fileList);
      e.target.value = "";

      if (!picked.length) {
        onError("خواندن تصویر ناموفق بود");
        return;
      }

      const room = MAX_PROMPT_IMAGES - pendingRef.current.length;
      if (room <= 0) {
        onError(`حداکثر ${MAX_PROMPT_IMAGES} تصویر`);
        return;
      }

      const slice = picked.slice(0, room);
      const added: PendingChatImage[] = [];

      for (const file of slice) {
        setProcessingFiles((n) => n + 1);
        try {
          if (file.size > MAX_PROMPT_IMAGE_BYTES) {
            onError("هر تصویر باید حداکثر ۱۵ مگابایت باشد");
            continue;
          }

          const previewUrl = await readFileAsDataUrl(file);
          const mimeType =
            resolveClientImageMime(file) ?? resolvePromptImageMimeFromDataUrl(previewUrl);
          if (!mimeType) {
            onError("فقط PNG، JPEG، GIF و WebP پشتیبانی می‌شود");
            continue;
          }

          const comma = previewUrl.indexOf(",");
          const data = comma >= 0 ? previewUrl.slice(comma + 1) : previewUrl;
          added.push({
            id: crypto.randomUUID(),
            name: file.name,
            mimeType,
            previewUrl,
            data,
          });
        } catch {
          onError("خواندن تصویر ناموفق بود");
        } finally {
          setProcessingFiles((n) => Math.max(0, n - 1));
        }
      }

      if (added.length) {
        setPending((prev) => [...prev, ...added].slice(0, MAX_PROMPT_IMAGES));
      }
    },
    [onError]
  );

  const openFilePicker = useCallback(() => {
    if (attachButtonDisabled) return;
    fileInputRef.current?.click();
  }, [attachButtonDisabled]);

  const removeImage = useCallback((id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const clearImages = useCallback(() => setPending([]), []);

  const buildImagePayload = useCallback(
    () =>
      pendingRef.current.map(({ data, mimeType, width, height }) => ({
        data,
        mimeType,
        ...(width && height ? { width, height } : {}),
      })),
    []
  );

  const canSendWithText = useCallback(
    (text: string) =>
      processingFiles === 0 && (text.trim().length > 0 || pending.length > 0),
    [pending.length, processingFiles]
  );

  const isProcessingFiles = processingFiles > 0;

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      id={fileInputId}
      type="file"
      accept={ACCEPT}
      multiple
      tabIndex={-1}
      disabled={inputPickDisabled}
      onChange={(e) => void onPickFiles(e)}
      style={{
        position: "fixed",
        left: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      }}
    />
  );

  const attachmentStrip: ReactNode =
    pending.length > 0 ? (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "0 4px 8px",
          width: "100%",
        }}
      >
        {pending.map((img) => (
          <div
            key={img.id}
            style={{
              position: "relative",
              width: 56,
              height: 56,
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.previewUrl}
              alt={img.name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            <button
              type="button"
              aria-label="حذف تصویر"
              onClick={() => removeImage(img.id)}
              style={{
                position: "absolute",
                top: 2,
                insetInlineStart: 2,
                width: 20,
                height: 20,
                borderRadius: 6,
                border: "none",
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                fontSize: 12,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    ) : null;

  return {
    pending,
    hiddenFileInput,
    openFilePicker,
    attachButtonDisabled,
    isProcessingFiles,
    attachmentStrip,
    buildImagePayload,
    clearImages,
    canSendWithText,
  };
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;

export { ComposerPaperclipIcon };
