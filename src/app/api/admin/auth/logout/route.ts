import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return Response.json({ ok: true });
}
