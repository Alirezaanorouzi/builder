import type { ReactNode } from "react";

/** Scrollable admin shell — root `body` uses overflow:hidden for the chat app. */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="app-admin-root">{children}</div>;
}
