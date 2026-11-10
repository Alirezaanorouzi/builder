import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session-constants";

const publicPaths = ["/sign-in", "/sign-up", "/api/auth", "/api/health"];

function isPublic(pathname: string) {
  return publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAdminPublic(pathname: string) {
  return (
    pathname === "/admin/sign-in" ||
    pathname === "/api/admin/auth/login" ||
    pathname === "/api/admin/auth/logout"
  );
}

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  if (isAdminPath(pathname)) {
    if (isAdminPublic(pathname)) {
      return NextResponse.next();
    }
    const adminCookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (!adminCookie) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/admin/sign-in", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/") && !isPublic(pathname)) {
    if (!getSessionCookie(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/chat") || pathname === "/" || pathname.startsWith("/api/me")) {
    if (!getSessionCookie(request)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/sign-in", "/sign-up", "/admin/:path*", "/api/:path*"],
};
