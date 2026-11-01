"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { signOutBuilderAccount } from "@/lib/sign-out";
import {
  BUILDER_BUILD_RUN_KEY,
  BUILDER_CHAT_SESSION_KEY,
  BUILDER_SITE_ID_KEY,
} from "@/lib/builder-client-storage";

type ChatLine =
  | { kind: "user"; text: string }
  | { kind: "status"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "activity"; text: string }
  | { kind: "preview"; url: string }
  | { kind: "error"; text: string };

const CHAT_SESSION_KEY = BUILDER_CHAT_SESSION_KEY;
const SITE_ID_KEY = BUILDER_SITE_ID_KEY;
const BUILD_RUN_KEY = BUILDER_BUILD_RUN_KEY;

type SiteSummary = {
  id: string;
  status: string;
  provisioningError?: string | null;
  productionUrl?: string | null;
};

export function Chat() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteStatus, setSiteStatus] = useState<string | null>(null);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [retryingProvision, setRetryingProvision] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/me");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      user?: { email?: string };
      sites?: SiteSummary[];
    };
    if (data.user?.email) setUserEmail(data.user.email);
    const sites = data.sites ?? [];
    const stored = localStorage.getItem(SITE_ID_KEY);
    const active =
      sites.find((s) => s.id === stored) ?? sites.find((s) => s.status === "active") ?? sites[0];
    if (active) {
      setSiteId(active.id);
      setSiteStatus(active.status);
      setProvisioningError(active.provisioningError ?? null);
      localStorage.setItem(SITE_ID_KEY, active.id);
      if (active.productionUrl && active.status === "active") {
        setPreviewUrl(active.productionUrl);
      }
    }
    return active;
  }, []);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const appendLine = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const startStream = useCallback(
    (buildRunId: string) => {
      closeStream();
      localStorage.setItem(BUILD_RUN_KEY, buildRunId);
      const params = new URLSearchParams({ buildRunId });
      const es = new EventSource(`/api/chat/stream?${params}`);
      esRef.current = es;

      es.addEventListener("status", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { message?: string };
        if (data.message) appendLine({ kind: "status", text: data.message });
      });

      es.addEventListener("assistant", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { text?: string };
        if (data.text) appendLine({ kind: "assistant", text: data.text });
      });

      es.addEventListener("activity", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { message?: string };
        if (data.message) appendLine({ kind: "activity", text: data.message });
      });

      es.addEventListener("preview", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { url?: string };
        if (data.url) {
          setPreviewUrl(data.url);
          appendLine({ kind: "preview", url: data.url });
        }
      });

      es.addEventListener("error", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { message?: string };
          appendLine({ kind: "error", text: data.message ?? "Something went wrong" });
        } catch {
          appendLine({ kind: "error", text: "Connection lost or stream error" });
        }
        setBusy(false);
        localStorage.removeItem(BUILD_RUN_KEY);
        closeStream();
      });

      es.addEventListener("done", () => {
        setBusy(false);
        localStorage.removeItem(BUILD_RUN_KEY);
        closeStream();
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) return;
        appendLine({ kind: "error", text: "Stream disconnected" });
        setBusy(false);
        localStorage.removeItem(BUILD_RUN_KEY);
        closeStream();
      };
    },
    [appendLine, closeStream]
  );

  useEffect(() => {
    void loadMe();
    const storedChat = localStorage.getItem(CHAT_SESSION_KEY);
    if (storedChat) setChatSessionId(storedChat);
    const storedBuild = localStorage.getItem(BUILD_RUN_KEY);
    if (storedBuild) {
      setBusy(true);
      startStream(storedBuild);
    }
  }, [loadMe, startStream]);

  useEffect(() => {
    if (siteStatus !== "provisioning" && siteStatus !== "failed") return;
    const timer = window.setInterval(() => {
      void loadMe();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [siteStatus, loadMe]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, busy]);

  useEffect(() => () => closeStream(), [closeStream]);

  const retryProvisioning = async () => {
    if (!siteId || retryingProvision) return;
    setRetryingProvision(true);
    setSiteStatus("provisioning");
    setProvisioningError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/provision`, { method: "POST" });
      const data = (await res.json()) as { error?: string; site?: SiteSummary };
      if (!res.ok) {
        setSiteStatus("failed");
        setProvisioningError(data.error ?? "Retry failed");
        return;
      }
      if (data.site) {
        setSiteStatus(data.site.status);
        setProvisioningError(data.site.provisioningError ?? null);
      }
      void loadMe();
    } catch (e) {
      setSiteStatus("failed");
      setProvisioningError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetryingProvision(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    closeStream();
    setBusy(false);
    try {
      const result = await signOutBuilderAccount();
      if (!result.ok) {
        appendLine({ kind: "error", text: result.message });
        return;
      }
      setUserEmail(null);
      setSiteId(null);
      setSiteStatus(null);
      setProvisioningError(null);
      setChatSessionId(null);
      setLines([]);
      setPreviewUrl(null);
      router.push("/sign-in");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (siteStatus && siteStatus !== "active") {
      appendLine({
        kind: "error",
        text:
          siteStatus === "provisioning"
            ? "Your site is still being set up (GitHub + Vercel). Wait a moment…"
            : provisioningError ??
              (siteStatus === "failed"
                ? "Site setup failed or is still finishing. Use “Retry GitHub + Vercel setup” in the header, or refresh the page."
                : "Site is not ready. Fix provisioning and try again."),
      });
      return;
    }

    setInput("");
    appendLine({ kind: "user", text });
    setBusy(true);

    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          siteId,
          chatSessionId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        siteId?: string;
        chatSessionId?: string;
        buildRunId?: string;
      };

      if (!res.ok) {
        appendLine({ kind: "error", text: data.error ?? "Request failed" });
        setBusy(false);
        return;
      }

      const sid = data.chatSessionId!;
      const newSiteId = data.siteId ?? siteId;
      if (newSiteId) {
        setSiteId(newSiteId);
        localStorage.setItem(SITE_ID_KEY, newSiteId);
      }
      setChatSessionId(sid);
      localStorage.setItem(CHAT_SESSION_KEY, sid);
      startStream(data.buildRunId!);
    } catch (e) {
      appendLine({
        kind: "error",
        text: e instanceof Error ? e.message : "Network error",
      });
      setBusy(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Website Builder</h1>
            <p style={styles.subtitle}>Describe your site — we build and deploy a preview.</p>
          </div>
          {userEmail && (
            <div style={styles.accountBar}>
              <span style={styles.accountEmail} title={userEmail}>
                {userEmail}
              </span>
              <button
                type="button"
                style={styles.signOutButton}
                disabled={busy || signingOut}
                onClick={() => void handleSignOut()}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
        {siteStatus === "provisioning" && (
          <p style={styles.provisioning}>Setting up your GitHub repo and Vercel project…</p>
        )}
        {siteStatus === "failed" && (
          <>
            <p style={styles.provisioningError}>
              {provisioningError ??
                "Setup did not finish. Retry below, or refresh the page if GitHub and Vercel are already connected."}
            </p>
            <button
              type="button"
              style={styles.retryProvisionButton}
              disabled={retryingProvision}
              onClick={() => void retryProvisioning()}
            >
              {retryingProvision ? "Retrying setup…" : "Retry GitHub + Vercel setup"}
            </button>
          </>
        )}
      </header>

      {previewUrl && (
        <div style={styles.previewBar}>
          <span style={styles.previewLabel}>Live preview</span>
          <a href={previewUrl} target="_blank" rel="noreferrer" style={styles.previewLink}>
            {previewUrl.replace(/^https:\/\//, "")}
          </a>
        </div>
      )}

      <div style={styles.chatColumn}>
        <div style={styles.messages}>
          {lines.length === 0 && (
            <p style={styles.placeholder}>
              Try: &quot;Build a small website for my dental clinic with hours and contact.&quot;
            </p>
          )}
          {lines.map((line, i) => (
            <div key={i} style={lineStyle(line)}>
              {line.kind === "preview" ? (
                <>
                  <strong>Your site is ready: </strong>
                  <a href={line.url} target="_blank" rel="noreferrer" style={styles.inlineLink}>
                    Open preview
                  </a>
                </>
              ) : (
                line.text
              )}
            </div>
          ))}
          {busy && <div style={styles.typing}>Working…</div>}
          <div ref={bottomRef} />
        </div>

        <footer style={styles.footer}>
          <textarea
            style={styles.input}
            rows={2}
            placeholder="Describe changes to your website…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            style={styles.button}
            disabled={busy || !input.trim() || siteStatus !== "active"}
            onClick={() => void send()}
          >
            {busy ? "Building…" : "Send"}
          </button>
        </footer>
      </div>
      </div>

      {previewUrl && (
        <aside style={styles.previewPanel}>
          <div style={styles.previewPanelHeader}>
            <span style={styles.previewLabel}>Preview</span>
            <div style={styles.previewModeToggle}>
              <button
                type="button"
                style={{
                  ...styles.previewModeButton,
                  ...(previewMode === "desktop" ? styles.previewModeActive : {}),
                }}
                onClick={() => setPreviewMode("desktop")}
              >
                Desktop
              </button>
              <button
                type="button"
                style={{
                  ...styles.previewModeButton,
                  ...(previewMode === "mobile" ? styles.previewModeActive : {}),
                }}
                onClick={() => setPreviewMode("mobile")}
              >
                Mobile
              </button>
            </div>
            <a href={previewUrl} target="_blank" rel="noreferrer" style={styles.previewOpenTab}>
              Open tab
            </a>
          </div>
          <div
            style={{
              ...styles.previewFrameWrap,
              ...(previewMode === "mobile" ? styles.previewFrameMobile : {}),
            }}
          >
            <iframe
              title="Site preview"
              src={previewUrl}
              style={styles.previewIframe}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </aside>
      )}
    </div>
  );
}

function lineStyle(line: ChatLine): CSSProperties {
  const base: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    maxWidth: "92%",
    lineHeight: 1.45,
    fontSize: 15,
  };
  switch (line.kind) {
    case "user":
      return { ...base, alignSelf: "flex-end", background: "var(--accent-dim)", color: "#fff" };
    case "assistant":
      return { ...base, alignSelf: "flex-start", background: "var(--surface)", border: "1px solid var(--border)" };
    case "status":
    case "activity":
      return { ...base, alignSelf: "center", color: "var(--muted)", fontSize: 13, background: "transparent" };
    case "preview":
      return { ...base, alignSelf: "flex-start", background: "#1e3a2f", border: "1px solid var(--success)", color: "var(--success)" };
    case "error":
      return { ...base, alignSelf: "flex-start", background: "#3a1e1e", border: "1px solid #c75b5b", color: "#ffb4b4" };
    default:
      return base;
  }
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "row",
    minHeight: "100dvh",
    width: "100%",
  },
  shell: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 420px",
    minWidth: 0,
    maxWidth: 640,
    margin: "0 auto",
  },
  chatColumn: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  },
  header: {
    padding: "20px 16px 8px",
    borderBottom: "1px solid var(--border)",
  },
  headerRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  accountBar: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    maxWidth: "100%",
  },
  accountEmail: {
    fontSize: 12,
    color: "var(--muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 220,
  },
  signOutButton: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--muted)",
    fontSize: 13,
    cursor: "pointer",
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  subtitle: { margin: "6px 0 0", color: "var(--muted)", fontSize: 14 },
  provisioning: { margin: "8px 0 0", color: "var(--accent)", fontSize: 13 },
  provisioningError: { margin: "8px 0 0", color: "#ffb4b4", fontSize: 13 },
  retryProvisionButton: {
    marginTop: 10,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
  },
  previewBar: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 16px",
    background: "var(--surface)",
    borderBottom: "1px solid var(--border)",
  },
  previewLabel: { fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 },
  previewLink: { color: "var(--success)", fontSize: 14, wordBreak: "break-all" },
  messages: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 16,
    overflowY: "auto",
  },
  placeholder: { color: "var(--muted)", fontSize: 14, lineHeight: 1.5 },
  typing: { color: "var(--muted)", fontSize: 13, padding: 8 },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 16,
    borderTop: "1px solid var(--border)",
    background: "var(--bg)",
  },
  input: {
    width: "100%",
    resize: "none",
    padding: 12,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
  },
  button: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "var(--accent)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
  inlineLink: { color: "inherit", fontWeight: 700 },
  previewPanel: {
    display: "flex",
    flex: "1 1 50%",
    flexDirection: "column",
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    minWidth: 0,
  },
  previewPanelHeader: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
  },
  previewModeToggle: { display: "flex", gap: 4, marginLeft: "auto" },
  previewModeButton: {
    padding: "4px 8px",
    fontSize: 12,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--muted)",
    cursor: "pointer",
  },
  previewModeActive: {
    background: "var(--accent-dim)",
    color: "#fff",
    borderColor: "var(--accent-dim)",
  },
  previewOpenTab: { fontSize: 12, color: "var(--accent)" },
  previewFrameWrap: {
    flex: 1,
    minHeight: 0,
    padding: 12,
    display: "flex",
    justifyContent: "center",
    alignItems: "stretch",
  },
  previewFrameMobile: {
    maxWidth: 390,
    margin: "0 auto",
    width: "100%",
  },
  previewIframe: {
    flex: 1,
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "#fff",
  },
};
