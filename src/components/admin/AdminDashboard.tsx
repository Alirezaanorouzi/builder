"use client";

import { useCallback, useEffect, useState } from "react";

type Overview = {
  northStar: {
    rate: number;
    counts: {
      registered: number;
      withSite: number;
      firstMessage: number;
      previewReady: number;
      activatedSharers: number;
    };
  };
  tokensToday: string;
};

type UserRow = {
  userId: string;
  email: string;
  hasSite: boolean;
  msToFirstMessage: number | null;
  msFirstMessageToPreview: number | null;
  editCountAfterFirstPreview: number;
  previewTabOpens: number;
  copyShareCount: number;
  tokensToday: string;
};

type MessageRow = {
  userEmail: string;
  text: string;
  createdAt: string;
};

type FlagRow = {
  key: string;
  enabled: boolean;
  description: string;
};

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}ث`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}د`;
  return `${(ms / 3_600_000).toFixed(1)}س`;
}

export function AdminDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAdminJson = async <T,>(url: string): Promise<T> => {
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? `خطا (${res.status})`);
    }
    return data;
  };

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [ov, us, msg, fl] = await Promise.all([
        fetchAdminJson<Overview>("/api/admin/metrics/overview"),
        fetchAdminJson<{ users?: UserRow[] }>("/api/admin/metrics/users?limit=50"),
        fetchAdminJson<{ messages?: MessageRow[] }>("/api/admin/messages?limit=20"),
        fetchAdminJson<{ flags?: FlagRow[] }>("/api/admin/flags"),
      ]);
      setOverview(ov);
      setUsers(us.users ?? []);
      setMessages(msg.messages ?? []);
      setFlags(fl.flags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "بارگذاری ناموفق");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const removeUser = async (userId: string, email: string) => {
    const ok = window.confirm(`کاربر ${email} و همهٔ داده‌هایش از پایگاه داده حذف شوند؟`);
    if (!ok) return;
    setError(null);
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "حذف ناموفق بود");
      return;
    }
    void load();
  };

  const toggleFlag = async (key: string, enabled: boolean) => {
    const res = await fetch("/api/admin/flags", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, enabled }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "تغییر پرچم ناموفق بود");
      return;
    }
    void load();
  };

  const signOut = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.href = "/admin/sign-in";
  };

  const pct = overview ? Math.round(overview.northStar.rate * 1000) / 10 : 0;

  return (
    <div dir="rtl" style={styles.page}>
      <header style={styles.header}>
        <h1 style={{ margin: 0, fontSize: 20 }}>پنل ادمین — اندازه‌گیری MVP</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={styles.btnGhost}
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "در حال بارگذاری…" : "بروزرسانی"}
          </button>
          <button type="button" style={styles.btnGhost} onClick={() => void signOut()}>
            خروج
          </button>
        </div>
      </header>

      {error ? <p style={{ color: "#ffb4b4" }}>{error}</p> : null}

      {overview ? (
        <section style={styles.card}>
          <h2 style={styles.h2}>North Star — ساخت + اشتراک/کپی لینک</h2>
          <p style={styles.big}>{pct}%</p>
          <p style={styles.muted}>
            {overview.northStar.counts.activatedSharers} از {overview.northStar.counts.registered} کاربر
          </p>
          <div style={styles.tiles}>
            <Tile label="ثبت‌نام" value={overview.northStar.counts.registered} />
            <Tile label="سایت دارند" value={overview.northStar.counts.withSite} />
            <Tile label="اولین پیام" value={overview.northStar.counts.firstMessage} />
            <Tile label="پیش‌نمایش آماده" value={overview.northStar.counts.previewReady} />
            <Tile label="توکن امروز (کل)" value={overview.tokensToday} />
          </div>
        </section>
      ) : null}

      <section style={styles.card}>
        <h2 style={styles.h2}>کاربران</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>ایمیل</th>
                <th>سایت</th>
                <th>تا پیام اول</th>
                <th>تا پیش‌نمایش</th>
                <th>ویرایش بعد</th>
                <th>تب پیش‌نمایش</th>
                <th>کپی/اشتراک</th>
                <th>توکن امروز</th>
                <th>حذف</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <td dir="ltr">{u.email}</td>
                  <td>{u.hasSite ? "✓" : "—"}</td>
                  <td>{fmtMs(u.msToFirstMessage)}</td>
                  <td>{fmtMs(u.msFirstMessageToPreview)}</td>
                  <td>{u.editCountAfterFirstPreview}</td>
                  <td>{u.previewTabOpens}</td>
                  <td>{u.copyShareCount}</td>
                  <td>{u.tokensToday}</td>
                  <td>
                    <button
                      type="button"
                      style={styles.btnDanger}
                      disabled={loading}
                      onClick={() => void removeUser(u.userId, u.email)}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>پیام‌های اخیر</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {messages.map((m) => (
            <li key={`${m.createdAt}-${m.userEmail}`} style={styles.msgRow}>
              <span dir="ltr" style={styles.muted}>
                {m.userEmail}
              </span>
              <span>{m.text.length > 120 ? `${m.text.slice(0, 120)}…` : m.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Feature flags</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {flags.map((f) => (
            <li key={f.key} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <label style={{ flex: 1, fontSize: 14 }}>
                <strong dir="ltr">{f.key}</strong>
                <span style={styles.muted}> — {f.description}</span>
              </label>
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => void toggleFlag(f.key, e.target.checked)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={styles.tile}>
      <span style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "24px 16px 48px",
    fontFamily: "inherit",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  h2: { margin: "0 0 12px", fontSize: 16 },
  big: { margin: 0, fontSize: 36, fontWeight: 700 },
  muted: { color: "var(--muted)", fontSize: 13 },
  tiles: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  tile: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    minWidth: 100,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  btnGhost: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
  },
  btnDanger: {
    padding: "4px 10px",
    borderRadius: 8,
    border: "1px solid #7a3030",
    background: "transparent",
    color: "#ffb4b4",
    fontSize: 12,
    cursor: "pointer",
  },
  msgRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  },
};
