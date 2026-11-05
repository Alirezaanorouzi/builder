"use client";

import { useEffect, useState } from "react";
import styles from "./space-waiting.module.css";

export type SpaceWaitingVariant = "setup" | "preview";

type Props = {
  message: string;
  variant?: SpaceWaitingVariant;
  /** When set, shows a Persian elapsed timer (mm:ss). */
  startedAtMs?: number;
};

function formatElapsedPersian(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const raw = `${m}:${s.toString().padStart(2, "0")}`;
  return raw.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function SpaceWaitingView({
  message,
  variant = "preview",
  startedAtMs,
}: Props) {
  const [elapsedMs, setElapsedMs] = useState(() =>
    startedAtMs != null ? Math.max(0, Date.now() - startedAtMs) : 0
  );

  useEffect(() => {
    if (startedAtMs == null) return;
    setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    const id = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  const isSetup = variant === "setup";
  const rootClass = isSetup
    ? `${styles.root} ${styles.rootSetup}`
    : `${styles.root} ${styles.rootPreview}`;

  return (
    <div
      className={rootClass}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
    >
      {isSetup ? (
        <>
          <div className={styles.sky} aria-hidden>
            <div className={styles.stars} />
            <div className={styles.glow} />
          </div>
          <div className={styles.stage} aria-hidden>
            <div className={styles.orbitOuter}>
              <span className={styles.satellite} />
            </div>
            <div className={styles.orbitInner} />
            <div className={styles.core} />
          </div>
        </>
      ) : (
        <div className={styles.warpField} aria-hidden>
          <div className={styles.warpVignette} />
          <div className={styles.warpStreaks} />
          <div className={`${styles.warpLayer} ${styles.warpLayerA}`} />
          <div className={`${styles.warpLayer} ${styles.warpLayerB}`} />
          <div className={`${styles.warpLayer} ${styles.warpLayerC}`} />
          <div className={styles.infinityPoint} />
        </div>
      )}

      <div className={isSetup ? styles.copy : `${styles.copy} ${styles.copyWarp}`}>
        <p className={styles.message}>{message}</p>
        {startedAtMs != null && (
          <p className={styles.elapsed}>{formatElapsedPersian(elapsedMs)}</p>
        )}
      </div>
    </div>
  );
}
