"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AgentActivity } from "@/components/AgentActivity";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import {
  useChatAttachments,
  ComposerPaperclipIcon,
  ComposerSendIcon,
} from "@/components/chat/ChatComposerAttachments";
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
import { trackAppOpenOnce, trackProductEvent } from "@/lib/analytics-client";
import { DEFERRED_DEPLOY_CONFIRMATION } from "@/lib/build-user-messages";
import { provisioningProgressPercent } from "@/lib/provisioning-progress";
import { signOutBuilderAccount } from "@/lib/sign-out";
import {
  BUILDER_BUILD_RUN_KEY,
  BUILDER_CHAT_SESSION_KEY,
  BUILDER_SITE_ID_KEY,
} from "@/lib/builder-client-storage";
import { UpgradeBar, type UsageView } from "@/components/UpgradeBar";

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
  provisioningStep?: string | null;
  provisioningError?: string | null;
  productionUrl?: string | null;
  productionCommitSha?: string | null;
};

type SsePayload = {
  eventId?: string;
  message?: string;
  text?: string;
  url?: string;
  tool?: string;
  path?: string;
  callId?: string;
  status?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  previewChanged?: boolean;
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

const AGENT_PHASE_STATUSES = new Set(["queued", "preparing_workspace", "running"]);
const DEPLOY_PHASE_STATUSES = new Set(["pushing", "deploying"]);

type HistoryTurn = {
  buildRunId: string;
  userMessage: string;
  assistantText: string;
  status: string;
};

function chatItemsFromHistoryTurns(turns: HistoryTurn[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const turn of turns) {
    out.push({
      id: `${turn.buildRunId}-user`,
      kind: "user",
      text: turn.userMessage,
    });
    const assistant = turn.assistantText.trim();
    if (assistant) {
      out.push({
        id: `${turn.buildRunId}-assistant`,
        kind: "assistant",
        text: assistant,
        buildRunId: turn.buildRunId,
      });
    }
  }
  return out;
}

function initialActivitySnapshot(startedAtMs?: number): AgentActivitySnapshot {
  return {
    phase: "working",
    startedAtMs: startedAtMs ?? Date.now(),
    timeline: [],
    expanded: false,
  };
}

const PREVIEW_TOOLBAR_ICON = 24;

function PreviewRefreshIcon() {
  return (
    <svg
      width={PREVIEW_TOOLBAR_ICON}
      height={PREVIEW_TOOLBAR_ICON}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.15-5.88" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function PreviewExternalLinkIcon() {
  return (
    <svg
      width={PREVIEW_TOOLBAR_ICON}
      height={PREVIEW_TOOLBAR_ICON}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v8H4V7h8" />
    </svg>
  );
}

export function Chat() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteStatus, setSiteStatus] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);
  const [provisioningStep, setProvisioningStep] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [retryingProvision, setRetryingProvision] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("mobile");
  const [activeTab, setActiveTab] = useState<"build" | "preview">("build");
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({
    preview_copy_button: true,
    preview_share_button: true,
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [buildWaitStartedAt, setBuildWaitStartedAt] = useState<number>(() => Date.now());
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewPublishing, setPreviewPublishing] = useState(false);
  const [awaitingDeployConfirm, setAwaitingDeployConfirm] = useState(false);
  const [publishWaitStartedAt, setPublishWaitStartedAt] = useState<number>(() => Date.now());
  const [usage, setUsage] = useState<UsageView | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollUserIdRef = useRef<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const seenEventIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const activeBuildRunRef = useRef<string | null>(null);
  /** Build run whose agent finished successfully (a later deploy failure must still be shown). */
  const agentSucceededRunRef = useRef<string | null>(null);
  const historyLoadedForSiteRef = useRef<string | null>(null);
  const productionShaBeforeDeployRef = useRef<string | null>(null);
  const lastSseSeqRef = useRef<string | null>(null);

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
        usage?: UsageView;
    };
      if (data.usage) setUsage(data.usage);
    if (data.user?.email) setUserEmail(data.user.email);
    const sites = data.sites ?? [];
    const stored = localStorage.getItem(SITE_ID_KEY);
    const active =
      sites.find((s) => s.id === stored) ?? sites.find((s) => s.status === "active") ?? sites[0];
    if (active) {
      setSiteId(active.id);
      setSiteStatus(active.status);
        setProvisioningStep(active.provisioningStep ?? null);
      setProvisioningError(active.provisioningError ?? null);
      localStorage.setItem(SITE_ID_KEY, active.id);
        if (active.status === "active" && active.productionUrl) {
        setPreviewUrl(active.productionUrl);
        } else {
          setPreviewUrl(null);
        }
        if (active.productionCommitSha != null) {
          productionShaBeforeDeployRef.current ??= active.productionCommitSha;
      }
    }
    trackAppOpenOnce(active?.id);
    return active;
    } finally {
      setMeReady(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/flags");
        if (!res.ok) return;
        const data = (await res.json()) as { flags?: Record<string, boolean> };
        if (data.flags) setFeatureFlags((prev) => ({ ...prev, ...data.flags }));
      } catch {
        /* optional */
      }
    })();
  }, []);

  const selectTab = useCallback(
    (tab: "build" | "preview") => {
      setActiveTab(tab);
      if (tab === "preview" && siteId) {
        trackProductEvent("preview_tab_open", { siteId });
      }
    },
    [siteId]
  );

  const openPreviewExternal = useCallback(() => {
    if (siteId) trackProductEvent("preview_external_open", { siteId });
  }, [siteId]);

  const closeStream = useCallback((keepPreviewWait = false) => {
    if (!keepPreviewWait) {
      setPreviewPublishing(false);
      setAwaitingDeployConfirm(false);
    }
    esRef.current?.close();
    esRef.current = null;
    if (!keepPreviewWait) activeBuildRunRef.current = null;
  }, []);

  const appendError = useCallback((text: string) => {
    setItems((prev) => [...prev, { id: newId(), kind: "error", text }]);
  }, []);

  const copyPreviewUrl = useCallback(async () => {
    if (!previewUrl || !siteId) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      trackProductEvent("preview_link_copied", { siteId });
    } catch {
      appendError("کپی لینک ناموفق بود");
    }
  }, [appendError, previewUrl, siteId]);

  const sharePreviewUrl = useCallback(async () => {
    if (!previewUrl || !siteId) return;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ url: previewUrl, title: "سایت من" });
        trackProductEvent("preview_link_shared", { siteId });
      }
    } catch {
      /* user cancelled share */
    }
  }, [previewUrl, siteId]);

  const attachments = useChatAttachments(appendError, busy);

  const refreshPreview = useCallback(() => {
    setPreviewRefreshKey((k) => k + 1);
  }, []);

  /** Agent finished; composer unlocks while deploy/preview may still run in the background. */
  const applyAgentDone = useCallback(
    (buildRunId: string, data: SsePayload) => {
      finishBuildRun(buildRunId, data);
      const failed =
        data.status === "failed" ||
        data.status === "cancelled" ||
        Boolean(data.errorMessage);
      if (failed) {
        setBusy(false);
      } else {
        agentSucceededRunRef.current = buildRunId;
        setBusy(false);
        void loadMe().then((site) => {
          productionShaBeforeDeployRef.current = site?.productionCommitSha ?? null;
        });
      }
    },
    [finishBuildRun, loadMe]
  );

  /** Terminal state of the whole run (agent + deployment confirmation). */
  const applyRunDone = useCallback(
    (buildRunId: string, data: SsePayload) => {
      const failed =
        data.status === "failed" ||
        data.status === "cancelled" ||
        Boolean(data.errorMessage);
      finishBuildRun(buildRunId, data);
      if (failed && data.errorMessage && agentSucceededRunRef.current === buildRunId) {
        // Agent work finished fine but publishing failed: the activity block is already closed.
        appendError(data.errorMessage);
      }
      setPreviewPublishing(false);
      setAwaitingDeployConfirm(false);
      setBusy(false);
      if (!failed) {
        // Single refresh instead of polling: the server confirmed the deployment before `done`.
        void loadMe().then((site) => {
          if (site?.productionCommitSha != null) {
            productionShaBeforeDeployRef.current = site.productionCommitSha;
          }
          if (site?.productionUrl && data.previewChanged !== false) refreshPreview();
        });
      }
    },
    [appendError, finishBuildRun, loadMe, refreshPreview]
  );

  const handleSsePayload = useCallback(
    (
      buildRunId: string,
      kind: RawActivityInput["kind"] | "assistant" | "agent_done" | "done" | "phase" | "preview",
      data: SsePayload
    ) => {
      const eventId = data.eventId ?? `${kind}-${Date.now()}`;

      if (kind === "preview") {
        if (data.url) setPreviewUrl(data.url);
        setPreviewPublishing(false);
        setAwaitingDeployConfirm(false);
        refreshPreview();
        return;
      }

      if (kind === "assistant") {
        if (data.text) appendAssistantChunk(buildRunId, eventId, data.text);
        return;
      }

      if (kind === "phase") {
        if (data.status === "deploying") {
          setPublishWaitStartedAt(Date.now());
          setPreviewPublishing(true);
          void loadMe().then((site) => {
            if (site?.productionCommitSha != null) {
              productionShaBeforeDeployRef.current = site.productionCommitSha;
            }
          });
        }
        return;
      }

      if (kind === "agent_done") {
        const seen = getSeenSet(buildRunId);
        if (seen.has(eventId)) return;
        seen.add(eventId);
        applyAgentDone(buildRunId, data);
        return;
      }

      if (kind === "done") {
        const seen = getSeenSet(buildRunId);
        if (seen.has(eventId)) return;
        seen.add(eventId);
        applyRunDone(buildRunId, data);
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
        if (agentSucceededRunRef.current === buildRunId && data.message) {
          // Agent finished fine but publishing failed: its activity block is already closed.
          appendError(data.message);
        }
        return;
      }

      if (kind === "status" || kind === "activity") {
        if (!data.message?.trim() && kind === "status") return;
        if (
          kind === "status" &&
          agentSucceededRunRef.current === buildRunId &&
          data.message === DEFERRED_DEPLOY_CONFIRMATION
        ) {
          setPreviewPublishing(true);
          setAwaitingDeployConfirm(true);
        }
        ingestActivity(buildRunId, {
          eventId,
          kind,
          message: data.message ?? "",
          meta: {
            tool: data.tool,
            path: data.path,
            callId: data.callId,
            status: data.status,
          },
        });
      }
    },
    [
      appendAssistantChunk,
      appendError,
      applyAgentDone,
      applyRunDone,
      finishBuildRun,
      getSeenSet,
      ingestActivity,
      loadMe,
      refreshPreview,
    ]
  );

  const startStream = useCallback(
    (buildRunId: string, resumeFromSeq?: string | null) => {
      closeStream(Boolean(resumeFromSeq));
      activeBuildRunRef.current = buildRunId;
      localStorage.setItem(BUILD_RUN_KEY, buildRunId);
      if (!resumeFromSeq) {
        agentSucceededRunRef.current = null;
        setBuildWaitStartedAt(Date.now());
      }
      ensureActivityBlock(buildRunId);

      const params = new URLSearchParams({ buildRunId });
      const lastSeq = resumeFromSeq ?? lastSseSeqRef.current;
      if (lastSeq && /^\d+$/.test(lastSeq)) {
        params.set("lastEventId", lastSeq);
      }
      const es = new EventSource(`/api/chat/stream?${params}`);
      esRef.current = es;

      const bind = (eventName: string, kind: Parameters<typeof handleSsePayload>[1]) => {
        es.addEventListener(eventName, (ev) => {
          try {
            const mev = ev as MessageEvent;
            if (mev.lastEventId) lastSseSeqRef.current = mev.lastEventId;
            const data = JSON.parse(mev.data) as SsePayload;
            handleSsePayload(buildRunId, kind, data);
          } catch {
            /* ignore malformed */
          }
        });
      };

      bind("status", "status");
      bind("activity", "activity");
      bind("assistant", "assistant");
      bind("phase", "phase");
      bind("preview", "preview");
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
        const shouldResume =
          previewPublishing || awaitingDeployConfirm || Boolean(agentSucceededRunRef.current);
        closeStream(shouldResume);
        if (shouldResume && activeBuildRunRef.current === buildRunId) {
          window.setTimeout(() => {
            if (activeBuildRunRef.current === buildRunId) {
              startStream(buildRunId, lastSseSeqRef.current);
            }
          }, 2000);
          return;
        }
        appendError("جریان قطع شد");
        finishBuildRun(buildRunId, { status: "failed", errorMessage: "Stream disconnected" });
        setBusy(false);
      };
    },
    [
      appendError,
      awaitingDeployConfirm,
      closeStream,
      ensureActivityBlock,
      finishBuildRun,
      handleSsePayload,
      previewPublishing,
    ]
  );

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!meReady || !siteId) return;
    if (historyLoadedForSiteRef.current === siteId) return;
    historyLoadedForSiteRef.current = siteId;

    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams({ siteId });
    const storedChat = localStorage.getItem(CHAT_SESSION_KEY);
      if (storedChat) params.set("chatSessionId", storedChat);
      try {
        const res = await fetch(`/api/chat/history?${params}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          chatSessionId: string | null;
          turns: HistoryTurn[];
          items?: ChatItem[];
          activeBuildRunId: string | null;
        };
        if (data.chatSessionId) {
          setChatSessionId(data.chatSessionId);
          localStorage.setItem(CHAT_SESSION_KEY, data.chatSessionId);
        }
        if (data.items?.length) {
          setItems(data.items as ChatItem[]);
        } else {
          setItems(chatItemsFromHistoryTurns(data.turns ?? []));
        }
    const storedBuild = localStorage.getItem(BUILD_RUN_KEY);
        const resumeId =
          data.activeBuildRunId ??
          (storedBuild && data.turns?.some((t) => t.buildRunId === storedBuild) ? storedBuild : null);
        if (!resumeId) return;
        const activeTurn = data.turns?.find((t) => t.buildRunId === resumeId);
        if (activeTurn) {
          if (DEPLOY_PHASE_STATUSES.has(activeTurn.status)) {
            setPublishWaitStartedAt(Date.now());
            setPreviewPublishing(true);
          } else if (AGENT_PHASE_STATUSES.has(activeTurn.status)) {
      setBusy(true);
          }
        }
        startStream(resumeId);
      } catch {
        /* history optional on first visit */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meReady, siteId, startStream]);

  useEffect(() => {
    if (siteStatus !== "provisioning" && siteStatus !== "failed") return;
    const timer = window.setInterval(() => {
      void loadMe();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [siteStatus, loadMe]);

  useEffect(() => {
    if (!awaitingDeployConfirm || !siteId) return;
    const tick = async () => {
      const site = await loadMe();
      if (!site?.productionCommitSha) return;
      const before = productionShaBeforeDeployRef.current;
      if (before && site.productionCommitSha !== before) {
        setAwaitingDeployConfirm(false);
        setPreviewPublishing(false);
        productionShaBeforeDeployRef.current = site.productionCommitSha;
        if (site.productionUrl) refreshPreview();
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 6000);
    return () => window.clearInterval(timer);
  }, [awaitingDeployConfirm, loadMe, refreshPreview, siteId]);

  useLayoutEffect(() => {
    const userId = pendingScrollUserIdRef.current;
    if (!userId) return;
    const container = messagesScrollRef.current;
    if (!container) return;
    const messageEl = container.querySelector<HTMLElement>(`[data-chat-item-id="${userId}"]`);
    if (!messageEl) return;
    pendingScrollUserIdRef.current = null;
    const turn = messageEl.closest<HTMLElement>(".chat-latest-turn");
    if (turn && turn.getBoundingClientRect().height + 1 < container.clientHeight) {
      turn.style.minHeight = `${container.clientHeight}px`;
    }
    scrollChatItemToTop(container, messageEl);
  }, [items]);

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

  useEffect(() => {
    if (!accountOpen) setSignOutConfirm(false);
  }, [accountOpen]);

  const toggleActivityExpanded = (buildRunId: string) => {
    const container = messagesScrollRef.current;
    const scrollTop = container?.scrollTop ?? 0;
    updateActivity(buildRunId, (snap) => ({ ...snap, expanded: !snap.expanded }));
    const restore = () => {
      if (container) container.scrollTop = scrollTop;
    };
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
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

  const quotaLocked =
    usage?.lockedUntil != null && Date.parse(usage.lockedUntil) > Date.now();

  const send = async () => {
    const text = input.trim();
    if (quotaLocked) return;
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
    const userMessageId = newId();
    pendingScrollUserIdRef.current = userMessageId;
    setItems((prev) => [
      ...prev,
      {
        id: userMessageId,
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
        code?: string;
        usage?: UsageView;
        siteId?: string;
        chatSessionId?: string;
        buildRunId?: string;
      };

      if (!res.ok) {
        if (res.status === 429 && data.code === "QUOTA_LOCKED" && data.usage) {
          setUsage(data.usage);
        setBusy(false);
          return;
        }
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
      <header
        className={showAccountSetup ? "app-header-bar app-header-over-setup" : "app-header-bar"}
        style={styles.header}
      >
        <div style={styles.headerStart}>
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
                  <a
                    href="https://t.me/+WsUMm76hSOo4MDQ0"
                    target="_blank"
                    rel="noreferrer"
                    role="menuitem"
                    style={styles.accountMenuLink}
                    onClick={() => setAccountOpen(false)}
                  >
                    گروه تلگرام
                  </a>
                  {signOutConfirm ? (
                    <div style={styles.accountSignOutRollup}>
                      <p style={styles.accountSignOutQuestion}>از حساب خود خارج میشوید؟</p>
                      <div style={styles.accountSignOutActions}>
                        <button
                          type="button"
                          style={styles.accountSignOutNo}
                          disabled={signingOut}
                          onClick={() => setSignOutConfirm(false)}
                        >
                          خیر
                        </button>
                        <button
                          type="button"
                          style={styles.accountSignOutYes}
                          disabled={busy || signingOut}
                          onClick={() => void handleSignOut()}
                        >
                          {signingOut ? "…" : "بله"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.accountMenuSignOut}
                      disabled={busy || signingOut}
                      onClick={() => setSignOutConfirm(true)}
                    >
                      خروج
                    </button>
                  )}
            </div>
          )}
        </div>
          )}
        </div>

        {!showAccountSetup && (
          <div style={styles.headerCenter}>
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
                onClick={() => selectTab("preview")}
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
                onClick={() => selectTab("build")}
              >
                ساخت
              </button>
            </div>
          </div>
        )}

        <div style={styles.headerEnd} aria-hidden />
      </header>

      {showAccountSetup ? (
        <div className="app-setup-overlay">
          <AccountSetupWaitingView
            setupProgress={provisioningProgressPercent(provisioningStep, siteStatus)}
          />
        </div>
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
          <div
            ref={messagesScrollRef}
            className="app-messages"
            style={{
              ...styles.messages,
              ...(items.length === 0 ? styles.messagesEmpty : {}),
            }}
          >
            {items.length === 0 && (
              <p style={styles.placeholderHero}>چی تو ذهنته؟</p>
            )}
            {renderChatItems(items, toggleActivityExpanded, selectTab, styles)}
        </div>

          <footer className="app-composer" style={styles.footer}>
            {usage ? (
              <UpgradeBar usage={usage} onExpire={() => void loadMe()} />
            ) : null}
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
                disabled={attachments.attachButtonDisabled || quotaLocked}
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
                disabled={busy || quotaLocked}
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
                  quotaLocked ||
                  !attachments.canSendWithText(input) ||
                  siteStatus !== "active"
                    ? styles.sendButtonDisabled
                    : {}),
                }}
                disabled={
                  busy ||
                  quotaLocked ||
                  !attachments.canSendWithText(input) ||
                  siteStatus !== "active"
                }
                aria-label={busy ? "در حال ساخت" : "ارسال"}
            onClick={() => void send()}
          >
                {busy ? (
                  <span style={styles.sendBusy}>…</span>
                ) : (
                  <ComposerSendIcon />
                )}
          </button>
            </div>
        </footer>
      </div>
      ) : (
        <div className="app-preview" style={styles.previewColumn}>
          {previewPublishing || busy ? (
            <PreviewWaitingView
              startedAtMs={previewPublishing ? publishWaitStartedAt : buildWaitStartedAt}
              statusText={previewPublishing ? PREVIEW_WAIT_PUBLISHING : PREVIEW_WAIT_BUILDING}
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
                  style={styles.previewToolbarIconButton}
                  aria-label="بروزرسانی پیش‌نمایش"
                  onClick={refreshPreview}
                >
                  <PreviewRefreshIcon />
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
                {featureFlags.preview_copy_button !== false ? (
                  <button
                    type="button"
                    style={styles.previewToolbarIconButton}
                    aria-label="کپی لینک سایت"
                    title="کپی لینک"
                    onClick={() => void copyPreviewUrl()}
                  >
                    ⎘
                  </button>
                ) : null}
                {featureFlags.preview_share_button !== false &&
                typeof navigator !== "undefined" &&
                "share" in navigator ? (
                  <button
                    type="button"
                    style={styles.previewToolbarIconButton}
                    aria-label="اشتراک لینک"
                    title="اشتراک"
                    onClick={() => void sharePreviewUrl()}
                  >
                    ↗
                  </button>
                ) : null}
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.previewOpenTab}
                  aria-label="باز کردن در تب جدید"
                  title="باز کردن در تب جدید"
                  onClick={openPreviewExternal}
                >
                  <PreviewExternalLinkIcon />
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
  const lastUserIndex = items.reduce(
    (found, item, index) => (item.kind === "user" ? index : found),
    -1
  );
  const before: ReactNode[] = [];
  const latest: ReactNode[] = [];
  let i = 0;

  while (i < items.length) {
    const bucket = lastUserIndex >= 0 && i >= lastUserIndex ? latest : before;
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

      bucket.push(
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
      bucket.push(
        <div key={item.id} className="chat-assistant-turn">
          <ChatMarkdown content={item.text} className="chat-assistant-markdown" />
        </div>
      );
      i += 1;
      continue;
    }

    bucket.push(
      <div key={item.id} data-chat-item-id={item.id} style={itemStyle(item)}>
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

  if (latest.length === 0) return before;
  return [
    ...before,
    <div key="chat-latest-turn" className="chat-latest-turn">
      {latest}
    </div>,
  ];
}

function scrollChatItemToTop(
  container: HTMLElement,
  messageEl: HTMLElement,
  paddingPx = 12
) {
  const containerRect = container.getBoundingClientRect();
  const messageRect = messageEl.getBoundingClientRect();
  const nextTop = container.scrollTop + (messageRect.top - containerRect.top) - paddingPx;
  container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
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
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 8,
    paddingBlock: 10,
    paddingInline: 12,
    borderBottom: "1px solid var(--border)",
    background: "var(--bg)",
  },
  headerStart: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    minWidth: 0,
  },
  headerCenter: {
    display: "flex",
    justifyContent: "center",
    justifySelf: "center",
  },
  headerEnd: {
    minWidth: 0,
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
    background: "rgba(255, 255, 255, 0.12)",
    color: "var(--text)",
    boxShadow: "none",
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
  accountMenuLink: {
    display: "block",
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 6,
    textAlign: "center",
    textDecoration: "none",
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
  accountSignOutRollup: {
    marginTop: 4,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
  },
  accountSignOutQuestion: {
    margin: "0 0 10px",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text)",
    textAlign: "center",
  },
  accountSignOutActions: {
    display: "flex",
    gap: 8,
  },
  accountSignOutNo: {
    flex: 1,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
  },
  accountSignOutYes: {
    flex: 1,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--accent-dim)",
    color: "#fff",
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
  messagesEmpty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: "12vh",
  },
  previewInline: {
    fontSize: 14,
    lineHeight: 1.55,
  },
  placeholder: { color: "var(--muted)", fontSize: 14, lineHeight: 1.6, margin: 0 },
  placeholderHero: {
    margin: 0,
    textAlign: "center",
    color: "var(--muted)",
    fontSize: "clamp(20px, 5.5vw, 24px)",
    fontWeight: 500,
    lineHeight: 1.5,
  },
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
    width: 42,
    height: 42,
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
    width: 42,
    height: 42,
    borderRadius: "50%",
    border: "none",
    background: "#fff",
    color: "#111",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginInlineStart: 4,
    marginBottom: 0,
  },
  sendBusy: {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
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
  previewToolbarIconButton: {
    width: 40,
    height: 40,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "none",
    borderRadius: 8,
    background: "transparent",
    color: "var(--text)",
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
  previewOpenTab: {
    marginInlineStart: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    padding: 0,
    border: "none",
    borderRadius: 8,
    background: "transparent",
    color: "var(--text)",
    textDecoration: "none",
  },
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
