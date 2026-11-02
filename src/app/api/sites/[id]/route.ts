import {
  assertSiteAccess,
  jsonError,
  requireSessionUser,
} from "@/lib/access";
import { prisma } from "@/lib/db";
import { serializeSiteForClient } from "@/lib/sites";
import { transitionSiteStatus } from "@/services/site-status.service";
import { requireAdminUser } from "@/services/user.service";
import type { SiteStatus } from "@prisma/client";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const site = await assertSiteAccess(user.id, id);
    return Response.json({ site: serializeSiteForClient(site) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const body = (await req.json()) as {
      displayName?: string;
      status?: SiteStatus;
      suspendReason?: string | null;
    };

    let site = await assertSiteAccess(user.id, id);
    const admin = await requireAdminUser(user.id).catch(() => null);

    if (body.displayName?.trim()) {
      site = await prisma.site.update({
        where: { id },
        data: { displayName: body.displayName.trim(), updatedAt: new Date() },
        include: { resources: true },
      });
    }

    if (body.status && admin) {
      if (body.status === "suspended") {
        await transitionSiteStatus(id, "suspended", {
          message: "Suspended by admin",
          suspendReason: body.suspendReason ?? "Suspended by platform admin",
        });
      } else {
        await transitionSiteStatus(id, body.status, {
          message: `Status set to ${body.status} by admin`,
          setActivatedAt: body.status === "active",
          suspendReason: body.status === "active" ? null : body.suspendReason,
        });
      }
      site = await prisma.site.findFirstOrThrow({
        where: { id },
        include: { resources: true },
      });
    } else if (body.status && !admin) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    return Response.json({ site: serializeSiteForClient(site) });
  } catch (e) {
    return jsonError(e);
  }
}
