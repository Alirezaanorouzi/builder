"use client";

import { useEffect, useState } from "react";
import {
  collapsedActivityLabel,
  formatElapsedSeconds,
  mergeTimelineForDisplay,
  type AgentActivitySnapshot,
} from "@/lib/agent-activity";
import { ChevronExpand } from "@/components/chat/ChevronExpand";
import styles from "./agent-activity.module.css";

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

  const statusDotClass = [
    styles.statusDot,
    snapshot.phase === "working" && styles.statusWorking,
    snapshot.phase === "completed" && styles.statusDone,
    snapshot.phase === "failed" && styles.statusFailed,
    snapshot.phase === "cancelled" && styles.statusCancelled,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.wrap}>
      {canToggle ? (
        <button
          type="button"
          className={styles.header}
          onClick={onToggleExpanded}
          aria-expanded={snapshot.expanded}
        >
          <span className={statusDotClass} />
          <span className={styles.titleRow}>
            <span className={styles.headerLabel}>{label}</span>
            <ChevronExpand expanded={snapshot.expanded} />
          </span>
        </button>
      ) : (
        <div className={styles.headerStatic} aria-live="polite">
          <span className={statusDotClass} />
          <span className={styles.headerLabel}>{label}</span>
          {elapsed && <span className={styles.elapsed}>{elapsed}</span>}
        </div>
      )}

      {showTimeline && (
        <div className={styles.body}>
          {displayTimeline.length === 0 && snapshot.phase === "working" && (
            <p className={styles.empty}>
              {snapshot.receivedAssistant
                ? "پاسخ داده شد — در حال اتمام…"
                : "در انتظار فعالیت عامل…"}
            </p>
          )}
          <ul className={styles.timeline}>
            {displayTimeline.map((entry, index) => {
              const isLast = index === displayTimeline.length - 1;
              const isActive =
                snapshot.phase === "working" && isLast;
              return (
                <li key={entry.eventId} className={styles.timelineItem}>
                  <span
                    className={`${styles.timelineDot}${isActive ? ` ${styles.timelineDotActive}` : ""}`}
                    aria-hidden
                  />
                  <span className={styles.timelineLabel}>{entry.label}</span>
                </li>
              );
            })}
          </ul>
          {snapshot.errorMessage && snapshot.phase === "failed" && (
            <p className={styles.errorDetail}>{snapshot.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
