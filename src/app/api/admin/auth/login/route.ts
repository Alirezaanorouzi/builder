import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  createAdminSessionToken,
  getAdminCredentials,
  verifyAdminLogin,
} from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!getAdminCredentials()) {
    return Response.json({ error: "Admin login not configured" }, { status: 503 });
  }
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return Response.json({ error: "email and password required" }, { status: 400 });
  }
  if (!verifyAdminLogin(email, password)) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const token = createAdminSessionToken(email);
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, token, adminSessionCookieOptions());
  return Response.json({ ok: true });
}
