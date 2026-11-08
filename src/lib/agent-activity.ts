/** Client-side agent activity timeline (BuildRun SSE → Cursor-like UX). */

import { categoryForTool, type ToolActivityCategory } from "@/lib/cursor-tool-labels";

export type AgentRunPhase = "working" | "completed" | "failed" | "cancelled";

export type ActivityEventMeta = {
  tool?: string;
  path?: string;
  status?: string;
  callId?: string;
};

export type RawActivityInput = {
  eventId: string;
  kind: "status" | "activity" | "error";
  message: string;
  meta?: ActivityEventMeta;
  atMs?: number;
};

export type ActivityCategory =
  | ToolActivityCategory
  | "deploy"
  | "error"
  | "system";

export type ActivityTimelineEntry = {
  eventId: string;
  atMs: number;
  label: string;
  category: ActivityCategory;
  callId?: string;
};

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

export function rawInputToTimelineEntry(input: RawActivityInput): ActivityTimelineEntry {
  const atMs = input.atMs ?? Date.now();
  if (input.kind === "error") {
    return { eventId: input.eventId, atMs, label: input.message, category: "error" };
  }
  if (input.kind === "activity") {
    const tool = input.meta?.tool ?? "";
    const category = tool ? categoryForTool(tool) : "system";
    return {
      eventId: input.eventId,
      atMs,
      label: input.message,
      category,
      callId: input.meta?.callId,
    };
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
      if (cat === "explore") {
        label = count === 1 ? first.label : `مرور ${count} فایل`;
      } else if (cat === "search") {
        label = count === 1 ? first.label : `جستجو (${count} بار)`;
      } else if (cat === "read") {
        label = count === 1 ? first.label : `خواندن ${count} فایل`;
      } else if (cat === "edit") {
        label = count === 1 ? first.label : `ویرایش ${count} فایل`;
      } else if (cat === "command") {
        label = count === 1 ? first.label : `اجرای ${count} دستور`;
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
  let timeline = snapshot.timeline;

  const callId = input.meta?.callId?.trim();
  if (input.kind === "activity" && callId) {
    const idx = timeline.findIndex((e) => e.callId === callId);
    if (idx >= 0) {
      const prev = timeline[idx]!;
      timeline = [
        ...timeline.slice(0, idx),
        {
          ...entry,
          eventId: prev.eventId,
          atMs: prev.atMs,
          callId,
        },
        ...timeline.slice(idx + 1),
      ];
    } else {
      timeline = [...timeline, entry];
    }
  } else {
    timeline = [...timeline, entry];
  }

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
