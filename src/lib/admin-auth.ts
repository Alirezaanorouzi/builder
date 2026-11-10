import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { HttpError } from "@/lib/http-error";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session-constants";

export { ADMIN_SESSION_COOKIE };
const SESSION_DAYS = 7;

function sessionSecret(): string {
  const secret =
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET or BETTER_AUTH_SECRET is required for admin sessions");
  }
  return secret;
}

export function getAdminCredentials(): { email: string; password: string } | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) return null;
  return { email, password };
}

export function verifyAdminLogin(email: string, password: string): boolean {
  const creds = getAdminCredentials();
  if (!creds) return false;
  const emailOk =
    email.trim().toLowerCase().length === creds.email.length &&
    timingSafeEqual(Buffer.from(email.trim().toLowerCase()), Buffer.from(creds.email));
  const passOk =
    password.length === creds.password.length &&
    timingSafeEqual(Buffer.from(password), Buffer.from(creds.password));
  return emailOk && passOk;
}

type SessionPayload = { email: string; exp: number };

function signPayload(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createAdminSessionToken(email: string): string {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ email: email.trim().toLowerCase(), exp } satisfies SessionPayload);
  const body = Buffer.from(payload, "utf8").toString("base64url");
  const sig = signPayload(body);
  return `${body}.${sig}`;
}

function parseAdminSessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = signPayload(body);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.email || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    const creds = getAdminCredentials();
    if (!creds || payload.email !== creds.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export async function getAdminSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return parseAdminSessionToken(token);
}

export async function requireAdminSession(): Promise<SessionPayload> {
  const session = await getAdminSession();
  if (!session) {
    throw new HttpError("Forbidden", 403);
  }
  return session;
}
