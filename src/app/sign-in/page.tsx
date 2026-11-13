"use client";

import {
  FormEvent,
  Suspense,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { signOutBuilderAccount } from "@/lib/sign-out";

function SignInPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = searchParams.get("mode");
    if (m === "sign-in" || m === "sign-up") {
      setMode(m);
    }
  }, [searchParams]);

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
          setError(res.error.message ?? "ثبت‌نام ناموفق بود");
          return;
        }
      } else {
        const res = await authClient.signIn.email({
          email,
          password,
        });
        if (res.error) {
          setError(res.error.message ?? "ورود ناموفق بود");
          return;
        }
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  if (!isPending && session?.user) {
    const signedInEmail = session.user.email ?? "حساب شما";
    return (
      <div className="app-sign-in" style={{ paddingTop: 48 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>قبلاً وارد شده‌اید</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
          با <strong dir="ltr">{signedInEmail}</strong> وارد هستید. برای تست حساب دیگر ابتدا خارج شوید.
        </p>
        {error && <p style={{ color: "#ffb4b4", fontSize: 14 }}>{error}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
          <button type="button" style={buttonStyle} onClick={() => router.push("/")}>
            رفتن به بیلدر
          </button>
          <button
            type="button"
            disabled={busy}
            style={{
              ...buttonStyle,
              background: "transparent",
              color: "var(--accent)",
              border: "1px solid var(--border)",
            }}
            onClick={() => void handleSignOut()}
          >
            {busy ? "…" : "خروج"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-sign-in" style={{ paddingTop: 48 }}>
      <h1 style={titleStyle}>
        {mode === "sign-in" ? "ورود به بیلدر" : "ایجاد حساب در بیلدر"}
      </h1>
      <form
        onSubmit={(e) => void onSubmit(e)}
        style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 28 }}
      >
        {mode === "sign-up" && (
          <AuthField label="نام">
            <input
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </AuthField>
        )}
        <AuthField label="ایمیل">
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </AuthField>
        <AuthField label="رمز عبور">
          <input
            type="password"
            name="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={8}
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </AuthField>
        {error && <p style={{ color: "#ffb4b4", fontSize: 14 }}>{error}</p>}
        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? "…" : mode === "sign-in" ? "ورود" : "ثبت‌نام"}
        </button>
      </form>
      <button
        type="button"
        style={{ ...buttonStyle, background: "transparent", color: "var(--accent)", marginTop: 12 }}
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
      >
        {mode === "sign-in" ? "حساب ندارید؟ ثبت‌نام" : "حساب دارید؟ ورود"}
      </button>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="app-sign-in" style={{ textAlign: "center" }}>
          در حال بارگذاری…
        </div>
      }
    >
      <SignInPageInner />
    </Suspense>
  );
}

function AuthField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
  textAlign: "right",
  lineHeight: 1.4,
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 6,
};

const fieldLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 500,
  color: "var(--muted)",
  textAlign: "right",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
  color: "var(--text)",
};

const buttonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
