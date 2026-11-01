"use client";

import { authClient } from "@/lib/auth-client";
import { clearBuilderClientStorage } from "@/lib/builder-client-storage";

export async function signOutBuilderAccount(): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await authClient.signOut();
  if (res.error) {
    return {
      ok: false,
      message:
        res.error.message ??
        "Sign out failed. Ensure BETTER_AUTH_URL in .env.local matches the port shown when you run npm run dev.",
    };
  }
  clearBuilderClientStorage();
  return { ok: true };
}
