import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Website Builder",
  description: "Build a small site with AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
