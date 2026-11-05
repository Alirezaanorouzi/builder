"use client";

import { SpaceWaitingView } from "@/components/space-waiting";

type Props = {
  startedAtMs: number;
  statusText: string;
};

export function PreviewWaitingView({ startedAtMs, statusText }: Props) {
  return (
    <SpaceWaitingView
      message={statusText}
      variant="preview"
      startedAtMs={startedAtMs}
    />
  );
}
