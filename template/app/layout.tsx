import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Website",
  description: "Customer website",
};

/** Agent: set lang, dir, fonts (prefer next/font/local), and metadata from DESIGN.md. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
