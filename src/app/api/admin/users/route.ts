import { jsonError, requireSessionUser } from "@/lib/access";
import { listUsersForAdmin, requireAdminUser } from "@/services/user.service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const session = await requireSessionUser();
    await requireAdminUser(session.id);
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const result = await listUsersForAdmin({ limit, offset });
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
