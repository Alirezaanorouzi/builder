import { requireAdminSession } from "@/lib/admin-auth";
import { HttpError } from "@/lib/http-error";
import { deleteUserAsAdmin, updateUserAsAdmin } from "@/services/user.service";
import type { UserAccountStatus, UserRole } from "@prisma/client";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function jsonError(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : "Server error";
  return Response.json({ error: message }, { status: 500 });
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await requireAdminSession();
    const { id } = await params;
    const removed = await deleteUserAsAdmin(id);
    return Response.json({ ok: true, user: removed });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    await requireAdminSession();
    const { id } = await params;
    const body = (await req.json()) as {
      role?: UserRole;
      accountStatus?: UserAccountStatus;
      suspendedReason?: string | null;
    };
    const user = await updateUserAsAdmin(id, body);
    return Response.json({ user });
  } catch (e) {
    return jsonError(e);
  }
}
