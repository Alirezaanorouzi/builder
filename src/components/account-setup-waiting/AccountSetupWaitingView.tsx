"use client";

import { SpaceWaitingView } from "@/components/space-waiting";

const DEFAULT_MESSAGE =
  "لطفاً صبر کنید، ما در حال راه‌اندازی حساب شما هستیم.";

type Props = {
  message?: string;
};

export function AccountSetupWaitingView({ message = DEFAULT_MESSAGE }: Props) {
  return <SpaceWaitingView message={message} variant="setup" />;
}
