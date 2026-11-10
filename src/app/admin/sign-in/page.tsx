"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "ورود ناموفق بود");
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("خطای شبکه");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-sign-in" dir="rtl">
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>ورود ادمین</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 24px" }}>
        پنل اندازه‌گیری MVP
      </p>
      <form onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          ایمیل
          <input
            type="email"
            dir="ltr"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          رمز عبور
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>
        {error ? (
          <p style={{ color: "#ffb4b4", fontSize: 13, margin: 0 }}>{error}</p>
        ) : null}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "…" : "ورود"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
  color: "var(--text)",
};

const buttonStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent-dim)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 500,
  cursor: "pointer",
};
