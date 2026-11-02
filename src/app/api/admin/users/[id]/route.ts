import { jsonError, requireSessionUser } from "@/lib/access";
import { requireAdminUser, updateUserAsAdmin } from "@/services/user.service";
import type { UserAccountStatus, UserRole } from "@prisma/client";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requireSessionUser();
    await requireAdminUser(session.id);
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
