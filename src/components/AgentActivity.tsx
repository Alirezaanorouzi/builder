"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  collapsedActivityLabel,
  formatElapsedSeconds,
  mergeTimelineForDisplay,
  type AgentActivitySnapshot,
} from "@/lib/agent-activity";
import { ChevronExpand } from "@/components/chat/ChevronExpand";

type Props = {
  snapshot: AgentActivitySnapshot;
  onToggleExpanded: () => void;
};

export function AgentActivity({ snapshot, onToggleExpanded }: Props) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (snapshot.phase !== "working") return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [snapshot.phase]);

  const label = collapsedActivityLabel(snapshot);
  const elapsed =
    snapshot.phase === "working"
      ? formatElapsedSeconds(snapshot.startedAtMs)
      : undefined;
  const displayTimeline = mergeTimelineForDisplay(snapshot.timeline);
  const showTimeline =
    snapshot.phase === "working" ? true : snapshot.expanded;
  const canToggle = snapshot.phase !== "working";

  return (
    <div style={styles.wrap}>
      {canToggle ? (
        <button
          type="button"
          style={styles.header}
          onClick={onToggleExpanded}
          aria-expanded={snapshot.expanded}
        >
          <span
            style={{
              ...styles.statusDot,
              ...(snapshot.phase === "working" ? styles.statusWorking : {}),
              ...(snapshot.phase === "completed" ? styles.statusDone : {}),
              ...(snapshot.phase === "failed" ? styles.statusFailed : {}),
              ...(snapshot.phase === "cancelled" ? styles.statusCancelled : {}),
            }}
          />
          <span style={styles.titleRow}>
            <span style={styles.headerLabel}>{label}</span>
            <ChevronExpand expanded={snapshot.expanded} />
          </span>
        </button>
      ) : (
        <div style={styles.headerStatic} aria-live="polite">
          <span
            style={{
              ...styles.statusDot,
              ...(snapshot.phase === "working" ? styles.statusWorking : {}),
            }}
          />
          <span style={styles.headerLabel}>{label}</span>
          {elapsed && <span style={styles.elapsed}>{elapsed}</span>}
        </div>
      )}

      {showTimeline && (
        <div style={styles.body}>
          {displayTimeline.length === 0 && snapshot.phase === "working" && (
            <p style={styles.empty}>
              {snapshot.receivedAssistant
                ? "پاسخ داده شد — در حال اتمام…"
                : "در انتظار فعالیت عامل…"}
            </p>
          )}
          <ul style={styles.list}>
            {displayTimeline.map((entry) => (
              <li key={entry.eventId} style={styles.listItem}>
                <span>{entry.label}</span>
              </li>
            ))}
          </ul>
          {snapshot.errorMessage && snapshot.phase === "failed" && (
            <p style={styles.errorDetail}>{snapshot.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    alignSelf: "stretch",
    padding: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "2px 0",
    border: "none",
    background: "transparent",
    color: "var(--muted)",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "start",
    justifyContent: "flex-start",
  },
  headerStatic: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "2px 0",
    color: "var(--muted)",
    fontSize: 13,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--muted)",
    flexShrink: 0,
  },
  statusWorking: { background: "var(--accent)" },
  statusDone: { background: "var(--success)" },
  statusFailed: { background: "#c75b5b" },
  statusCancelled: { background: "var(--muted)" },
  titleRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  headerLabel: { fontWeight: 500, color: "var(--muted)", textAlign: "start" },
  elapsed: { color: "var(--muted)", fontSize: 12, opacity: 0.85 },
  body: {
    padding: "4px 0 8px 14px",
    borderInlineStart: "1px solid var(--border)",
    marginTop: 4,
    marginBottom: 4,
  },
  empty: { margin: "0 0 6px", color: "var(--muted)", fontSize: 13 },
  list: { margin: 0, padding: 0, listStyle: "none" },
  listItem: {
    fontSize: 13,
    color: "var(--muted)",
    lineHeight: 1.5,
    marginBottom: 4,
  },
  errorDetail: {
    margin: "8px 0 0",
    fontSize: 13,
    color: "#ffb4b4",
    lineHeight: 1.45,
  },
};
