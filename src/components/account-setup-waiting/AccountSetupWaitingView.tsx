"use client";

import { SpaceWaitingView } from "@/components/space-waiting";

const DEFAULT_MESSAGE =
  "لطفاً صبر کنید، ما در حال راه‌اندازی حساب شما هستیم.";

const DEFAULT_SUBMESSAGE = "ممکن است ۱ تا ۲ دقیقه زمان ببرد.";

type Props = {
  message?: string;
  subMessage?: string;
  setupProgress?: number;
};

export function AccountSetupWaitingView({
  message = DEFAULT_MESSAGE,
  subMessage = DEFAULT_SUBMESSAGE,
  setupProgress = 8,
}: Props) {
  return (
    <SpaceWaitingView
      message={message}
      subMessage={subMessage}
      variant="setup"
      setupProgress={setupProgress}
    />
  );
}
