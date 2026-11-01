import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";

const authBaseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** Allow sign-out/sign-in when dev server port differs from BETTER_AUTH_URL (common locally). */
const devTrustedOrigins =
  process.env.NODE_ENV === "development"
    ? [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
      ]
    : [];

export const auth = betterAuth({
  baseURL: authBaseUrl,
  trustedOrigins: [authBaseUrl, ...devTrustedOrigins],
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [nextCookies()],
});

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};
