/** Client-side agent activity timeline (BuildRun SSE → Cursor-like UX). */

export type AgentRunPhase = "working" | "completed" | "failed" | "cancelled";

export type ActivityEventMeta = {
  tool?: string;
  path?: string;
  status?: string;
};

export type RawActivityInput = {
  eventId: string;
  kind: "status" | "activity" | "error";
  message: string;
  meta?: ActivityEventMeta;
  atMs?: number;
};

export type ActivityTimelineEntry = {
  eventId: string;
  atMs: number;
  label: string;
  category: ActivityCategory;
};

export type ActivityCategory =
  | "explore"
  | "search"
  | "read"
  | "edit"
  | "command"
  | "deploy"
  | "system"
  | "error";

export type AgentActivitySnapshot = {
  phase: AgentRunPhase;
  startedAtMs: number;
  endedAtMs?: number;
  timeline: ActivityTimelineEntry[];
  errorMessage?: string;
  expanded: boolean;
  /** Set when assistant text arrived (chat-only runs may have no tool timeline). */
  receivedAssistant?: boolean;
};

export function formatElapsedSeconds(startMs: number, endMs?: number): string {
  const end = endMs ?? Date.now();
  const sec = Math.max(0, Math.floor((end - startMs) / 1000));
  if (sec < 1) return "<1s";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function collapsedActivityLabel(snapshot: AgentActivitySnapshot): string {
  const elapsed = formatElapsedSeconds(snapshot.startedAtMs, snapshot.endedAtMs);
  switch (snapshot.phase) {
    case "working":
      return "در حال کار…";
    case "completed":
      return `انجام شد (${elapsed})`;
    case "failed":
      return snapshot.endedAtMs ? `ناموفق (${elapsed})` : "ناموفق";
    case "cancelled":
      return snapshot.endedAtMs ? `لغو شد (${elapsed})` : "لغو شد";
  }
}

function classifyStatusMessage(message: string): { category: ActivityCategory; label: string } {
  return { category: "system", label: message };
}

function classifyToolActivity(message: string, meta?: ActivityEventMeta): { category: ActivityCategory; label: string } {
  const tool = (meta?.tool ?? "").toLowerCase();
  const path = meta?.path?.trim();

  if (tool.includes("grep") || tool.includes("search") || message.toLowerCase().includes("search")) {
    return { category: "search", label: "Searched codebase" };
  }
  if (tool.includes("list") || tool.includes("glob") || tool.includes("explore")) {
    return { category: "explore", label: path ? `Explored ${path}` : "Explored files" };
  }
  if (tool.includes("read") || message.toLowerCase().includes("read")) {
    return { category: "read", label: path ? `Read ${path}` : "Read file" };
  }
  if (
    tool.includes("write") ||
    tool.includes("edit") ||
    tool.includes("replace") ||
    message.toLowerCase().includes("updating website")
  ) {
    return { category: "edit", label: path ? `Edited ${path}` : "Edited files" };
  }
  if (tool.includes("terminal") || tool.includes("run_terminal") || message.toLowerCase().includes("running commands")) {
    return { category: "command", label: "Running build checks" };
  }
  if (tool.includes("browser") || message.toLowerCase().includes("browser")) {
    return { category: "command", label: "Testing in browser" };
  }
  return { category: "system", label: message };
}

export function rawInputToTimelineEntry(input: RawActivityInput): ActivityTimelineEntry {
  const atMs = input.atMs ?? Date.now();
  if (input.kind === "error") {
    return { eventId: input.eventId, atMs, label: input.message, category: "error" };
  }
  if (input.kind === "activity") {
    const { category, label } = classifyToolActivity(input.message, input.meta);
    return { eventId: input.eventId, atMs, label, category };
  }
  const { category, label } = classifyStatusMessage(input.message);
  return { eventId: input.eventId, atMs, label, category };
}

/** Merge consecutive same-category steps into summary lines (Cursor-style). */
export function mergeTimelineForDisplay(entries: ActivityTimelineEntry[]): ActivityTimelineEntry[] {
  if (entries.length === 0) return [];

  const out: ActivityTimelineEntry[] = [];
  let batch: ActivityTimelineEntry[] = [entries[0]];

  const flush = () => {
    if (batch.length === 0) return;
    const first = batch[0];
    const cat = first.category;
    if (batch.length === 1 || cat === "error" || cat === "system" || cat === "deploy") {
      out.push(first);
      for (let i = 1; i < batch.length; i++) {
        if (batch[i].label !== out[out.length - 1]?.label) out.push(batch[i]);
      }
    } else {
      const count = batch.length;
      let label = first.label;
      if (cat === "explore") label = count === 1 ? first.label : `Explored ${count} files`;
      else if (cat === "search") label = count === 1 ? "Searched codebase" : `Searched ${count} times`;
      else if (cat === "read") {
        const paths = batch.map((e) => e.label.replace(/^Read /, "")).filter((p) => p && p !== "Read file");
        label = paths.length === 1 ? `Read ${paths[0]}` : paths.length > 1 ? `Read ${paths.length} files` : first.label;
      } else if (cat === "edit") {
        label = count === 1 ? first.label : `Edited ${count} files`;
      } else if (cat === "command") {
        label = count === 1 ? first.label : `Ran ${count} commands`;
      }
      out.push({ ...first, label });
    }
    batch = [];
  };

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    const prevCat = batch[0].category;
    if (e.category === prevCat && e.category !== "error" && e.category !== "deploy") {
      batch.push(e);
    } else {
      flush();
      batch = [e];
    }
  }
  flush();
  return out;
}

export function applyRawActivityEvent(
  snapshot: AgentActivitySnapshot,
  input: RawActivityInput,
  seenEventIds: Set<string>
): AgentActivitySnapshot {
  if (seenEventIds.has(input.eventId)) return snapshot;
  seenEventIds.add(input.eventId);

  const entry = rawInputToTimelineEntry(input);
  const timeline = [...snapshot.timeline, entry];

  if (input.kind === "error") {
    return {
      ...snapshot,
      timeline,
      errorMessage: input.message,
    };
  }

  return { ...snapshot, timeline };
}

export function terminalPhaseFromRunStatus(
  status: string
): AgentRunPhase | null {
  if (status === "succeeded") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return null;
}

export function finalizeAgentActivity(
  snapshot: AgentActivitySnapshot,
  phase: AgentRunPhase,
  options?: { endedAtMs?: number; errorMessage?: string }
): AgentActivitySnapshot {
  return {
    ...snapshot,
    phase,
    endedAtMs: options?.endedAtMs ?? snapshot.endedAtMs ?? Date.now(),
    errorMessage: options?.errorMessage ?? snapshot.errorMessage,
  };
}
