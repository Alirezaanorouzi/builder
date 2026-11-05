"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AgentActivity } from "@/components/AgentActivity";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { useChatAttachments, ComposerPaperclipIcon } from "@/components/chat/ChatComposerAttachments";
import { PreviewWaitingView } from "@/components/preview-waiting";
import { AccountSetupWaitingView } from "@/components/account-setup-waiting";
import {
  applyRawActivityEvent,
  finalizeAgentActivity,
  terminalPhaseFromRunStatus,
  type AgentActivitySnapshot,
  type AgentRunPhase,
  type RawActivityInput,
} from "@/lib/agent-activity";
import { signOutBuilderAccount } from "@/lib/sign-out";
import {
  BUILDER_BUILD_RUN_KEY,
  BUILDER_CHAT_SESSION_KEY,
  BUILDER_SITE_ID_KEY,
} from "@/lib/builder-client-storage";

type ChatItem =
  | {
      id: string;
      kind: "user";
      text: string;
      imagePreviews?: string[];
    }
  | { id: string; kind: "assistant"; text: string; buildRunId: string }
  | { id: string; kind: "agentActivity"; buildRunId: string; snapshot: AgentActivitySnapshot }
  | { id: string; kind: "preview"; url: string }
  | { id: string; kind: "error"; text: string };

const CHAT_SESSION_KEY = BUILDER_CHAT_SESSION_KEY;
const SITE_ID_KEY = BUILDER_SITE_ID_KEY;
const BUILD_RUN_KEY = BUILDER_BUILD_RUN_KEY;


const PREVIEW_WAIT_BUILDING = "در حال ساخت سایت…";
const PREVIEW_WAIT_PUBLISHING = "در حال منتشر کردن برنامه…";

type SiteSummary = {
  id: string;
  status: string;
  provisioningError?: string | null;
  productionUrl?: string | null;
};

type SsePayload = {
  eventId?: string;
  message?: string;
  text?: string;
  url?: string;
  tool?: string;
  path?: string;
  status?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
};

function buildPreviewIframeSrc(baseUrl: string, refreshKey: number): string {
  try {
    const url = new URL(baseUrl.includes("://") ? baseUrl : `https://${baseUrl}`);
    url.searchParams.set("_builder", String(refreshKey));
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function newId() {
  return crypto.randomUUID();
}

function initialActivitySnapshot(startedAtMs?: number): AgentActivitySnapshot {
  return {
    phase: "working",
    startedAtMs: startedAtMs ?? Date.now(),
    timeline: [],
    expanded: false,
  };
}

export function Chat() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteStatus, setSiteStatus] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [retryingProvision, setRetryingProvision] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("mobile");
  const [activeTab, setActiveTab] = useState<"build" | "preview">("build");
  const [accountOpen, setAccountOpen] = useState(false);
  const [buildWaitStartedAt, setBuildWaitStartedAt] = useState<number>(() => Date.now());
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewPublishing, setPreviewPublishing] = useState(false);
  const [publishWaitStartedAt, setPublishWaitStartedAt] = useState<number>(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const seenEventIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const activeBuildRunRef = useRef<string | null>(null);
  const previewRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRefreshScheduledRef = useRef(false);

  const getSeenSet = useCallback((buildRunId: string) => {
    let set = seenEventIdsRef.current.get(buildRunId);
    if (!set) {
      set = new Set();
      seenEventIdsRef.current.set(buildRunId, set);
    }
    return set;
  }, []);

  const updateActivity = useCallback(
    (buildRunId: string, updater: (snap: AgentActivitySnapshot) => AgentActivitySnapshot) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "agentActivity" || item.buildRunId !== buildRunId) return item;
          return { ...item, snapshot: updater(item.snapshot) };
        })
      );
    },
    []
  );

  const ingestActivity = useCallback(
    (buildRunId: string, input: RawActivityInput) => {
      const seen = getSeenSet(buildRunId);
      updateActivity(buildRunId, (snap) => applyRawActivityEvent(snap, input, seen));
    },
    [getSeenSet, updateActivity]
  );

  const appendAssistantChunk = useCallback((buildRunId: string, eventId: string, text: string) => {
    const seen = getSeenSet(buildRunId);
    if (seen.has(eventId)) return;
    seen.add(eventId);

    setItems((prev) => {
      const idx = prev.findIndex(
        (i) => i.kind === "assistant" && i.buildRunId === buildRunId
      );
      let next: ChatItem[];
      if (idx >= 0) {
        const cur = prev[idx];
        if (cur.kind !== "assistant") return prev;
        next = [...prev];
        next[idx] = { ...cur, text: cur.text + text };
      } else {
        const activityIdx = prev.findIndex(
          (i) => i.kind === "agentActivity" && i.buildRunId === buildRunId
        );
        const insertAt = activityIdx >= 0 ? activityIdx + 1 : prev.length;
        next = [...prev];
        next.splice(insertAt, 0, {
          id: newId(),
          kind: "assistant",
          buildRunId,
          text,
        });
      }
      return next.map((item) => {
        if (item.kind === "agentActivity" && item.buildRunId === buildRunId) {
          return {
            ...item,
            snapshot: { ...item.snapshot, receivedAssistant: true },
          };
        }
        return item;
      });
    });
  }, [getSeenSet]);

  const ensureActivityBlock = useCallback((buildRunId: string, startedAtMs?: number) => {
    setItems((prev) => {
      if (prev.some((i) => i.kind === "agentActivity" && i.buildRunId === buildRunId)) {
        return prev;
      }
      return [
        ...prev,
        {
          id: newId(),
          kind: "agentActivity",
          buildRunId,
          snapshot: initialActivitySnapshot(startedAtMs),
        },
      ];
    });
  }, []);

  const finishBuildRun = useCallback(
    (
      buildRunId: string,
      data: {
        status?: string;
        errorMessage?: string;
        startedAt?: string;
        finishedAt?: string;
      }
    ) => {
      const mapped = data.status ? terminalPhaseFromRunStatus(data.status) : null;
      const phase: AgentRunPhase = mapped ?? (data.errorMessage ? "failed" : "completed");
      const endedAtMs = data.finishedAt ? Date.parse(data.finishedAt) : Date.now();
      const startedAtMs = data.startedAt ? Date.parse(data.startedAt) : undefined;

      updateActivity(buildRunId, (snap) => {
        if (snap.phase !== "working") return snap;
        let next = snap;
        if (startedAtMs && !Number.isNaN(startedAtMs)) {
          next = { ...next, startedAtMs };
        }
        return finalizeAgentActivity(next, phase, {
          endedAtMs,
          errorMessage: data.errorMessage,
        });
      });
    },
    [updateActivity]
  );

  const loadMe = useCallback(async () => {
    try {
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
        if (active.status === "active" && active.productionUrl) {
          setPreviewUrl(active.productionUrl);
        } else {
          setPreviewUrl(null);
        }
      }
      return active;
    } finally {
      setMeReady(true);
    }
  }, []);

  const closeStream = useCallback(() => {
    if (previewRefreshTimerRef.current) {
      clearInterval(previewRefreshTimerRef.current);
      previewRefreshTimerRef.current = null;
    }
    setPreviewPublishing(false);
    esRef.current?.close();
    esRef.current = null;
    activeBuildRunRef.current = null;
  }, []);

  const appendError = useCallback((text: string) => {
    setItems((prev) => [...prev, { id: newId(), kind: "error", text }]);
  }, []);

  const attachments = useChatAttachments(appendError, busy);

  const refreshPreview = useCallback(() => {
    setPreviewRefreshKey((k) => k + 1);
  }, []);

  const schedulePreviewRefreshAfterBuild = useCallback(() => {
    if (previewRefreshScheduledRef.current) return;
    previewRefreshScheduledRef.current = true;
    if (previewRefreshTimerRef.current) {
      clearTimeout(previewRefreshTimerRef.current);
    }
    setPublishWaitStartedAt(Date.now());
    setPreviewPublishing(true);

    const pollMs = 8_000;
    const maxPolls = 24;
    let polls = 0;
    const pollForPreviewUrl = () => {
      polls += 1;
      void loadMe().then((site) => {
        if (site?.productionUrl) {
          setPreviewPublishing(false);
          refreshPreview();
          previewRefreshScheduledRef.current = false;
          if (previewRefreshTimerRef.current) {
            clearTimeout(previewRefreshTimerRef.current);
            previewRefreshTimerRef.current = null;
          }
        } else if (polls >= maxPolls) {
          setPreviewPublishing(false);
          refreshPreview();
          previewRefreshScheduledRef.current = false;
        }
      });
    };

    pollForPreviewUrl();
    previewRefreshTimerRef.current = setInterval(pollForPreviewUrl, pollMs);
    setTimeout(() => {
      if (previewRefreshTimerRef.current) {
        clearInterval(previewRefreshTimerRef.current);
        previewRefreshTimerRef.current = null;
      }
      setPreviewPublishing(false);
      previewRefreshScheduledRef.current = false;
    }, pollMs * maxPolls + 2_000);
  }, [loadMe, refreshPreview]);

  const applyAgentRunTerminal = useCallback(
    (buildRunId: string, data: SsePayload) => {
      finishBuildRun(buildRunId, data);
      const failed =
        data.status === "failed" ||
        data.status === "cancelled" ||
        Boolean(data.errorMessage);
      if (!failed) {
        schedulePreviewRefreshAfterBuild();
      }
      setBusy(false);
    },
    [finishBuildRun, schedulePreviewRefreshAfterBuild]
  );

  const handleSsePayload = useCallback(
    (buildRunId: string, kind: RawActivityInput["kind"] | "assistant" | "agent_done" | "done", data: SsePayload) => {
      const eventId = data.eventId ?? `${kind}-${Date.now()}`;

      if (kind === "assistant") {
        if (data.text) appendAssistantChunk(buildRunId, eventId, data.text);
        return;
      }

      if (kind === "agent_done") {
        const seen = getSeenSet(buildRunId);
        if (seen.has(eventId)) return;
        seen.add(eventId);
        applyAgentRunTerminal(buildRunId, data);
        return;
      }

      if (kind === "done") {
        const seen = getSeenSet(buildRunId);
        if (seen.has(eventId)) return;
        seen.add(eventId);
        applyAgentRunTerminal(buildRunId, data);
        return;
      }

      if (kind === "error") {
        ingestActivity(buildRunId, {
          eventId,
          kind: "error",
          message: data.message ?? "خطایی رخ داد",
        });
        finishBuildRun(buildRunId, {
          status: "failed",
          errorMessage: data.message,
        });
        return;
      }

      if (kind === "status" || kind === "activity") {
        if (!data.message?.trim() && kind === "status") return;
        ingestActivity(buildRunId, {
          eventId,
          kind,
          message: data.message ?? "",
          meta: {
            tool: data.tool,
            path: data.path,
            status: data.status,
          },
        });
      }
    },
    [appendAssistantChunk, applyAgentRunTerminal, finishBuildRun, getSeenSet, ingestActivity]
  );

  const startStream = useCallback(
    (buildRunId: string) => {
      closeStream();
      activeBuildRunRef.current = buildRunId;
      localStorage.setItem(BUILD_RUN_KEY, buildRunId);
      previewRefreshScheduledRef.current = false;
      setBuildWaitStartedAt(Date.now());
      ensureActivityBlock(buildRunId);

      const params = new URLSearchParams({ buildRunId });
      const es = new EventSource(`/api/chat/stream?${params}`);
      esRef.current = es;

      const bind = (eventName: string, kind: Parameters<typeof handleSsePayload>[1]) => {
        es.addEventListener(eventName, (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as SsePayload;
            handleSsePayload(buildRunId, kind, data);
          } catch {
            /* ignore malformed */
          }
        });
      };

      bind("status", "status");
      bind("activity", "activity");
      bind("assistant", "assistant");
      bind("agent_done", "agent_done");
      bind("done", "done");

      es.addEventListener("error", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as SsePayload;
          handleSsePayload(buildRunId, "error", data);
        } catch {
          appendError("اتصال قطع شد یا خطای جریان");
          finishBuildRun(buildRunId, { status: "failed", errorMessage: "Stream error" });
        }
        setBusy(false);
        localStorage.removeItem(BUILD_RUN_KEY);
        closeStream();
      });

      es.addEventListener("done", () => {
        localStorage.removeItem(BUILD_RUN_KEY);
        closeStream();
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) return;
        appendError("جریان قطع شد");
        finishBuildRun(buildRunId, { status: "failed", errorMessage: "Stream disconnected" });
        setBusy(false);
        closeStream();
      };
    },
    [appendError, closeStream, ensureActivityBlock, finishBuildRun, handleSsePayload]
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
    }, 6000);
    return () => window.clearInterval(timer);
  }, [siteStatus, loadMe]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, busy]);

  useEffect(() => () => closeStream(), [closeStream]);

  useEffect(() => {
    if (!accountOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [accountOpen]);

  const toggleActivityExpanded = (buildRunId: string) => {
    updateActivity(buildRunId, (snap) => ({ ...snap, expanded: !snap.expanded }));
  };

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
        setProvisioningError(data.error ?? "تلاش مجدد ناموفق بود");
        return;
      }
      if (data.site) {
        setSiteStatus(data.site.status);
        setProvisioningError(data.site.provisioningError ?? null);
      }
      void loadMe();
    } catch (e) {
      setSiteStatus("failed");
      setProvisioningError(e instanceof Error ? e.message : "تلاش مجدد ناموفق بود");
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
        appendError(result.message);
        return;
      }
      setUserEmail(null);
      setSiteId(null);
      setSiteStatus(null);
      setProvisioningError(null);
      setChatSessionId(null);
      setItems([]);
      seenEventIdsRef.current.clear();
      setPreviewUrl(null);
      router.push("/sign-in");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (attachments.isProcessingFiles) {
      appendError("لطفاً چند لحظه صبر کنید تا تصویر آماده شود.");
      return;
    }
    if (!text && attachments.pending.length === 0) return;
    if (busy) return;
    if (siteStatus && siteStatus !== "active") {
      appendError(
        siteStatus === "provisioning"
          ? "لطفاً چند لحظه صبر کنید؛ حساب شما در حال آماده‌سازی است."
          : provisioningError ??
              (siteStatus === "failed"
                ? "راه‌اندازی سایت کامل نشد. از دکمه تلاش مجدد در بالا استفاده کنید یا صفحه را رفرش کنید."
                : "سایت آماده نیست. راه‌اندازی را تکمیل کنید و دوباره تلاش کنید.")
      );
      return;
    }

    const imagePayload = attachments.buildImagePayload();
    const previews = attachments.pending.map((p) => p.previewUrl);

    setInput("");
    setItems((prev) => [
      ...prev,
      {
        id: newId(),
        kind: "user",
        text: text || "پیوست تصویر",
        imagePreviews: previews.length ? previews : undefined,
      },
    ]);
    attachments.clearImages();
    setBusy(true);
    setBuildWaitStartedAt(Date.now());

    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          siteId,
          chatSessionId,
          images: imagePayload.length ? imagePayload : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        siteId?: string;
        chatSessionId?: string;
        buildRunId?: string;
      };

      if (!res.ok) {
        if (res.status === 409) {
          localStorage.removeItem(BUILD_RUN_KEY);
          setBusy(false);
          closeStream();
        }
        appendError(data.error ?? "درخواست ناموفق بود");
        if (res.status !== 409) setBusy(false);
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

      const buildRunId = data.buildRunId!;
      startStream(buildRunId);
    } catch (e) {
      appendError(e instanceof Error ? e.message : "خطای شبکه");
      setBusy(false);
    }
  };

  const accountInitial =
    userEmail?.trim()[0]?.toUpperCase() ?? userEmail?.trim()[0] ?? "؟";

  const showAccountSetup = !meReady || siteStatus === "provisioning";

  return (
    <div className="app-root" style={styles.page}>
      <header className="app-header-bar" style={styles.header}>
        <div style={styles.headerSide}>
          {userEmail && (
            <div ref={accountRef} style={styles.accountWrap}>
              <button
                type="button"
                style={styles.accountButton}
                aria-expanded={accountOpen}
                aria-label="حساب کاربری"
                onClick={() => setAccountOpen((o) => !o)}
              >
                <span style={styles.accountAvatar}>{accountInitial}</span>
              </button>
              {accountOpen && (
                <div style={styles.accountMenu} role="menu">
                  <p style={styles.accountMenuEmail} dir="ltr">
                    {userEmail}
                  </p>
                  <button
                    type="button"
                    role="menuitem"
                    style={styles.accountMenuSignOut}
                    disabled={busy || signingOut}
                    onClick={() => {
                      setAccountOpen(false);
                      void handleSignOut();
                    }}
                  >
                    {signingOut ? "در حال خروج…" : "خروج"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={styles.headerSide}>
          {!showAccountSetup && (
        <div style={styles.tabGroup} role="tablist" aria-label="بخش‌های اصلی">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "preview"}
            className="app-tab"
            style={{
              ...styles.tab,
              ...(activeTab === "preview" ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab("preview")}
          >
            پیش‌نمایش
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "build"}
            className="app-tab"
            style={{
              ...styles.tab,
              ...(activeTab === "build" ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab("build")}
          >
            ساخت
          </button>
        </div>
          )}
        </div>

        <div style={styles.headerSide} />
      </header>

      {showAccountSetup ? (
        <AccountSetupWaitingView />
      ) : (
        <>
      {siteStatus === "failed" && (
        <div style={styles.banner}>
              <p style={styles.provisioningError}>
                {provisioningError ??
                  "راه‌اندازی کامل نشد. دوباره تلاش کنید یا اگر گیت‌هاب و ورسل وصل هستند صفحه را رفرش کنید."}
              </p>
              <button
                type="button"
                style={styles.retryProvisionButton}
                disabled={retryingProvision}
                onClick={() => void retryProvisioning()}
              >
                {retryingProvision ? "در حال تلاش…" : "تلاش مجدد راه‌اندازی"}
              </button>
        </div>
      )}

      {activeTab === "build" ? (
        <div className="app-main" style={styles.mainColumn}>
          <div className="app-messages" style={styles.messages}>
            {items.length === 0 && (
              <p style={styles.placeholder}>
                مثلاً: «یک سایت ساده برای کلینیک دندانپزشکی با ساعات کاری و تماس بساز.»
              </p>
            )}
            {renderChatItems(items, toggleActivityExpanded, setActiveTab, styles)}
            <div ref={bottomRef} />
          </div>

          <footer className="app-composer" style={styles.footer}>
            {attachments.hiddenFileInput}
            {attachments.attachmentStrip}
            <div style={styles.composerShell}>
              <button
                type="button"
                style={{
                  ...styles.attachButton,
                  opacity: attachments.attachButtonDisabled ? 0.4 : 1,
                  cursor: attachments.attachButtonDisabled ? "not-allowed" : "pointer",
                }}
                disabled={attachments.attachButtonDisabled}
                aria-label="پیوست تصویر"
                title="پیوست تصویر (حداکثر ۵)"
                onClick={attachments.openFilePicker}
              >
                {attachments.isProcessingFiles ? (
                  <span style={{ fontSize: 14 }}>…</span>
                ) : (
                  <ComposerPaperclipIcon />
                )}
              </button>
              <textarea
                style={styles.inputInner}
                rows={1}
                placeholder="تغییرات سایت را بنویسید…"
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
                style={{
                  ...styles.sendButton,
                  ...(busy ||
                  !attachments.canSendWithText(input) ||
                  siteStatus !== "active"
                    ? styles.sendButtonDisabled
                    : {}),
                }}
                disabled={
                  busy ||
                  !attachments.canSendWithText(input) ||
                  siteStatus !== "active"
                }
                aria-label={busy ? "در حال ساخت" : "ارسال"}
                onClick={() => void send()}
              >
                {busy ? "…" : "↑"}
              </button>
            </div>
          </footer>
        </div>
      ) : (
        <div className="app-preview" style={styles.previewColumn}>
          {busy || previewPublishing ? (
            <PreviewWaitingView
              startedAtMs={busy ? buildWaitStartedAt : publishWaitStartedAt}
              statusText={busy ? PREVIEW_WAIT_BUILDING : PREVIEW_WAIT_PUBLISHING}
            />
          ) : !previewUrl ? (
            <div style={styles.previewEmpty}>
              <p style={styles.placeholder}>هنوز پیش‌نمایشی نیست. از تب «ساخت» سایت را بسازید.</p>
            </div>
          ) : (
            <>
              <div className="app-preview-toolbar" style={styles.previewToolbar}>
                <button
                  type="button"
                  style={styles.previewRefreshButton}
                  aria-label="بروزرسانی پیش‌نمایش"
                  onClick={refreshPreview}
                >
                  ↻
                </button>
                <div className="app-preview-modes" style={styles.previewModeToggle}>
                  <button
                    type="button"
                    style={{
                      ...styles.previewModeButton,
                      ...(previewMode === "desktop" ? styles.previewModeActive : {}),
                    }}
                    onClick={() => setPreviewMode("desktop")}
                  >
                    دسکتاپ
                  </button>
                  <button
                    type="button"
                    style={{
                      ...styles.previewModeButton,
                      ...(previewMode === "mobile" ? styles.previewModeActive : {}),
                    }}
                    onClick={() => setPreviewMode("mobile")}
                  >
                    موبایل
                  </button>
                </div>
                <a href={previewUrl} target="_blank" rel="noreferrer" style={styles.previewOpenTab}>
                  باز کردن در تب جدید
                </a>
              </div>
              <div
                className="app-preview-frame"
                style={{
                  ...styles.previewFrameWrap,
                  ...(previewMode === "mobile" ? styles.previewFrameMobile : {}),
                }}
              >
                <iframe
                  key={previewRefreshKey}
                  title="پیش‌نمایش سایت"
                  src={buildPreviewIframeSrc(previewUrl, previewRefreshKey)}
                  className="app-preview-iframe"
                  style={styles.previewIframe}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            </>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function renderChatItems(
  items: ChatItem[],
  toggleActivityExpanded: (buildRunId: string) => void,
  setActiveTab: (tab: "build" | "preview") => void,
  styles: Record<string, CSSProperties>
) {
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (item.kind === "agentActivity") {
      const runId = item.buildRunId;
      const assistants: Extract<ChatItem, { kind: "assistant" }>[] = [];
      i += 1;
      while (i < items.length && items[i].kind === "assistant") {
        const next = items[i] as Extract<ChatItem, { kind: "assistant" }>;
        if (next.buildRunId !== runId) break;
        assistants.push(next);
        i += 1;
      }

      nodes.push(
        <div key={item.id} className="chat-assistant-turn">
          <AgentActivity
            snapshot={item.snapshot}
            onToggleExpanded={() => toggleActivityExpanded(runId)}
          />
          {assistants.map((a) => (
            <ChatMarkdown key={a.id} content={a.text} className="chat-assistant-markdown" />
          ))}
        </div>
      );
      continue;
    }

    if (item.kind === "assistant") {
      nodes.push(
        <div key={item.id} className="chat-assistant-turn">
          <ChatMarkdown content={item.text} className="chat-assistant-markdown" />
        </div>
      );
      i += 1;
      continue;
    }

    nodes.push(
      <div key={item.id} style={itemStyle(item)}>
        {item.kind === "preview" ? (
          <>
            <span style={styles.previewInline}>
              سایت آماده است —{" "}
              <button
                type="button"
                style={styles.inlineLinkButton}
                onClick={() => setActiveTab("preview")}
              >
                مشاهده پیش‌نمایش
              </button>
            </span>
          </>
        ) : item.kind === "user" ? (
          <>
            {item.text ? <div>{item.text}</div> : null}
            {item.imagePreviews?.length ? (
              <div style={styles.userImageRow}>
                {item.imagePreviews.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src.slice(0, 48)} src={src} alt="" style={styles.userImageThumb} />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          item.text
        )}
      </div>
    );
    i += 1;
  }

  return nodes;
}

function itemStyle(item: ChatItem): CSSProperties {
  const base: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 16,
    maxWidth: "88%",
    lineHeight: 1.55,
    fontSize: 15,
  };
  switch (item.kind) {
    case "user":
      return { ...base, alignSelf: "flex-start", background: "var(--accent-dim)", color: "#fff" };
    case "assistant":
      return {
        ...base,
        alignSelf: "stretch",
        maxWidth: "100%",
        padding: 0,
        background: "transparent",
      };
    case "preview":
      return {
        ...base,
        alignSelf: "stretch",
        maxWidth: "100%",
        padding: "6px 0",
        background: "transparent",
        color: "var(--success)",
        fontSize: 14,
      };
    case "error":
      return {
        ...base,
        alignSelf: "stretch",
        maxWidth: "100%",
        padding: "6px 0",
        background: "transparent",
        color: "#ffb4b4",
        fontSize: 14,
      };
    default:
      return base;
  }
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingBlock: 10,
    borderBottom: "1px solid var(--border)",
    background: "var(--bg)",
  },
  headerSide: {
    flex: "1 1 0",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
  },
  tabGroup: {
    display: "inline-flex",
    gap: 4,
    padding: 4,
    borderRadius: 999,
    background: "var(--surface)",
    border: "1px solid var(--border)",
  },
  tab: {
    padding: "8px 22px",
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color: "var(--muted)",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  },
  tabActive: {
    background: "var(--surface-elevated)",
    color: "var(--text)",
    boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
  },
  accountWrap: { position: "relative" },
  accountButton: {
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
  },
  accountAvatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "var(--surface-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 14,
    fontWeight: 600,
  },
  accountMenu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    insetInlineStart: 0,
    minWidth: 220,
    padding: 12,
    borderRadius: 12,
    background: "var(--surface-elevated)",
    border: "1px solid var(--border)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    zIndex: 20,
  },
  accountMenuEmail: {
    margin: "0 0 10px",
    fontSize: 13,
    color: "var(--muted)",
    wordBreak: "break-all",
  },
  accountMenuSignOut: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
  },
  banner: {
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface)",
  },
  provisioning: { margin: 0, color: "var(--accent)", fontSize: 13 },
  provisioningError: { margin: 0, color: "#ffb4b4", fontSize: 13 },
  retryProvisionButton: {
    marginTop: 10,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--surface-elevated)",
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
  },
  mainColumn: {
    display: "flex",
    flexDirection: "column",
  },
  messages: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "12px 12px 8px",
  },
  previewInline: {
    fontSize: 14,
    lineHeight: 1.55,
  },
  placeholder: { color: "var(--muted)", fontSize: 14, lineHeight: 1.6, margin: 0 },
  footer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 0,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
    background: "var(--bg)",
  },
  composerShell: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    width: "100%",
    padding: "6px 8px",
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "var(--input-bg)",
  },
  attachButton: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    padding: 0,
    border: "none",
    borderRadius: 10,
    background: "transparent",
    color: "var(--muted)",
  },
  inputInner: {
    flex: 1,
    resize: "none",
    padding: "8px 6px",
    borderRadius: 0,
    border: "none",
    background: "transparent",
    color: "var(--text)",
    minHeight: 36,
    lineHeight: 1.45,
    outline: "none",
  },
  userImageRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  userImageThumb: {
    width: 72,
    height: 72,
    objectFit: "cover",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
  },
  sendButton: {
    flexShrink: 0,
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "none",
    background: "#fff",
    color: "#111",
    fontWeight: 700,
    fontSize: 17,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginInlineStart: 2,
    marginBottom: 1,
  },
  sendButtonDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  inlineLinkButton: {
    padding: 0,
    border: "none",
    background: "none",
    color: "inherit",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
  },
  previewColumn: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  },
  previewEmpty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  previewToolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
  },
  previewRefreshButton: {
    width: 34,
    height: 34,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 18,
    lineHeight: 1,
    cursor: "pointer",
  },
  previewModeToggle: {
    display: "inline-flex",
    gap: 4,
    padding: 3,
    borderRadius: 999,
    background: "var(--surface)",
    border: "1px solid var(--border)",
  },
  previewModeButton: {
    padding: "5px 14px",
    fontSize: 12,
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color: "var(--muted)",
    cursor: "pointer",
  },
  previewModeActive: {
    background: "var(--surface-elevated)",
    color: "var(--text)",
  },
  previewOpenTab: { marginInlineStart: "auto", fontSize: 13, color: "var(--accent)" },
  previewFrameWrap: {
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
    borderRadius: 12,
    background: "#fff",
  },
};
