"use client";

import Link from "next/link";
import type { CSSProperties } from "react";

export function AuthPrompt() {
  return (
    <div style={styles.shell}>
      <div style={styles.card}>
        <h1 style={styles.title}>Website Builder</h1>
        <p style={styles.subtitle}>
          Sign in to provision your GitHub repo, connect Vercel, and chat with the build agent.
        </p>
        <div style={styles.actions}>
          <Link href="/sign-in" style={styles.primary}>
            Sign in
          </Link>
          <Link href="/sign-in?mode=sign-up" style={styles.secondary}>
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  shell: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100dvh",
    padding: 24,
  },
  card: {
    maxWidth: 420,
    width: "100%",
    padding: 28,
    borderRadius: 16,
    border: "1px solid var(--border)",
    background: "var(--surface)",
  },
  title: { margin: 0, fontSize: 24, fontWeight: 700 },
  subtitle: { margin: "12px 0 0", color: "var(--muted)", lineHeight: 1.5, fontSize: 15 },
  actions: { display: "flex", flexDirection: "column", gap: 10, marginTop: 28 },
  primary: {
    display: "block",
    textAlign: "center",
    padding: "12px 16px",
    borderRadius: 10,
    background: "var(--accent)",
    color: "#fff",
    fontWeight: 600,
    textDecoration: "none",
  },
  secondary: {
    display: "block",
    textAlign: "center",
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    color: "var(--accent)",
    fontWeight: 600,
    textDecoration: "none",
  },
};
