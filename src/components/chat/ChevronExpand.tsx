"use client";

import styles from "./chevron-expand.module.css";

type Props = {
  expanded: boolean;
  className?: string;
};

/** Minimal caret: points up when expanded, sideways when collapsed (RTL-friendly). */
export function ChevronExpand({ expanded, className }: Props) {
  return (
    <svg
      className={`${styles.icon}${expanded ? ` ${styles.expanded}` : ""}${className ? ` ${className}` : ""}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
    >
      <path
        d="M2 6.5L5 3.5L8 6.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
