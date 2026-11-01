"use client";

import { FormEvent, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { signOutBuilderAccount } from "@/lib/sign-out";

export default function SignInPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setError(null);
    setBusy(true);
    try {
      const result = await signOutBuilderAccount();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "sign-up") {
        const res = await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0] || "User",
        });
        if (res.error) {
          setError(res.error.message ?? "Sign up failed");
          return;
        }
      } else {
        const res = await authClient.signIn.email({
          email,
          password,
        });
        if (res.error) {
          setError(res.error.message ?? "Sign in failed");
          return;
        }
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!isPending && session?.user) {
    const signedInEmail = session.user.email ?? "your account";
    return (
      <div style={{ maxWidth: 400, margin: "48px auto", padding: 16 }}>
        <h1 style={{ fontSize: 22 }}>Already signed in</h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          You are signed in as <strong>{signedInEmail}</strong>. Sign out to create or test another account.
        </p>
        {error && <p style={{ color: "#ffb4b4", fontSize: 14 }}>{error}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
          <button type="button" style={buttonStyle} onClick={() => router.push("/")}>
            Continue to builder
          </button>
          <button
            type="button"
            disabled={busy}
            style={{ ...buttonStyle, background: "transparent", color: "var(--accent)", border: "1px solid var(--border)" }}
            onClick={() => void handleSignOut()}
          >
            {busy ? "…" : "Sign out"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 400, margin: "48px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>
        Required for multi-tenant builds. Local dev uses SQLite (`DATABASE_URL=file:./dev.db`); production can use Postgres/Neon.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        {mode === "sign-up" && (
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {error && <p style={{ color: "#ffb4b4", fontSize: 14 }}>{error}</p>}
        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? "…" : mode === "sign-in" ? "Sign in" : "Sign up"}
        </button>
      </form>
      <button
        type="button"
        style={{ ...buttonStyle, background: "transparent", color: "var(--accent)", marginTop: 12 }}
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
      >
        {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};

const buttonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
