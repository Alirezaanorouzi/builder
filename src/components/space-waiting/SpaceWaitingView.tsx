"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import styles from "./space-waiting.module.css";

const PREVIEW_IMAGE = "/waiting/build-waiting.png";

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

  const isPreview = variant === "preview";
  const rootClass = isPreview
    ? `${styles.root} ${styles.rootPreview}`
    : `${styles.root} ${styles.rootSetup}`;

  return (
    <div
      className={rootClass}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
    >
      {isPreview && (
        <div className={styles.backdrop} aria-hidden>
          <Image
            src={PREVIEW_IMAGE}
            alt=""
            fill
            priority
            sizes="100vw"
            className={`${styles.backdropImage} ${styles.backdropImagePreview}`}
          />
          <div className={`${styles.backdropScrim} ${styles.backdropScrimPreview}`} />
          <div className={styles.lightBloom} />
        </div>
      )}

      <div className={isPreview ? `${styles.copy} ${styles.copyPreview}` : `${styles.copy} ${styles.copySetup}`}>
        <p className={styles.message}>{message}</p>
        {startedAtMs != null && (
          <p className={styles.elapsed}>{formatElapsedPersian(elapsedMs)}</p>
        )}
      </div>
    </div>
  );
}
