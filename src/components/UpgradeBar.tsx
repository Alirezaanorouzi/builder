"use client";

import { useEffect, useState } from "react";

export type UsageView = {
  phase: number;
  usedPercent: number;
  lockedUntil: string | null;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "۰:۰۰";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

type Props = {
  usage: UsageView;
  onExpire?: () => void;
};

export function UpgradeBar({ usage, onExpire }: Props) {
  const upgradeHref =
    process.env.NEXT_PUBLIC_UPGRADE_URL?.trim() || "/pricing";

  const lockedUntilMs = usage.lockedUntil ? Date.parse(usage.lockedUntil) : 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!usage.lockedUntil || lockedUntilMs <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [usage.lockedUntil, lockedUntilMs]);

  useEffect(() => {
    if (!usage.lockedUntil) return;
    if (lockedUntilMs <= now) onExpire?.();
  }, [usage.lockedUntil, lockedUntilMs, now, onExpire]);

  if (!usage.lockedUntil || lockedUntilMs <= now) return null;

  const remaining = lockedUntilMs - now;

  return (
    <div className="upgrade-bar" role="status" dir="rtl">
      <p className="upgrade-bar__text">
        سقف استفاده در فاز {usage.phase} پر شده است. برای ادامه ساخت، طرح خود را ارتقا دهید یا
        پس از{" "}
        <span className="upgrade-bar__countdown" aria-live="polite">
          {formatCountdown(remaining)}
        </span>{" "}
        دوباره تلاش کنید.
      </p>
      <a className="upgrade-bar__link" href={upgradeHref}>
        ارتقای طرح
      </a>
    </div>
  );
}
