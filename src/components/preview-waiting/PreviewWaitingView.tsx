"use client";

import { useEffect, useState } from "react";
import { SinusoidalWaves } from "./SinusoidalWaves";
import styles from "./preview-waiting.module.css";

type Props = {
  startedAtMs: number;
  statusText: string;
};

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const raw = `${m}:${s.toString().padStart(2, "0")}`;
  return raw.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function PreviewWaitingView({ startedAtMs, statusText }: Props) {
  const [elapsedMs, setElapsedMs] = useState(() =>
    Math.max(0, Date.now() - startedAtMs)
  );

  useEffect(() => {
    setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    const id = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  return (
    <div className={styles.root} role="status" aria-live="polite" aria-busy="true">
      <div className={styles.horizon} aria-hidden />
      <SinusoidalWaves />
      <div className={styles.copy}>
        <p className={styles.status}>{statusText}</p>
        <p className={styles.elapsed}>{formatElapsed(elapsedMs)}</p>
      </div>
    </div>
  );
}
