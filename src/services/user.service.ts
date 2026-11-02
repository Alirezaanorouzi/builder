import { HttpError } from "@/lib/http-error";
import { prisma } from "@/lib/db";
import type { SiteStatus, UserAccountStatus, UserRole } from "@prisma/client";
import { getAdminEmails } from "@/lib/config";

export type PlatformUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  suspendedReason: string | null;
  createdAt: Date;
};

export async function getPlatformUser(userId: string): Promise<PlatformUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      accountStatus: true,
      suspendedReason: true,
      createdAt: true,
    },
  });
  if (!user) return null;

  const adminEmails = getAdminEmails();
  if (adminEmails.has(user.email.toLowerCase()) && user.role !== "admin") {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role: "admin" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        accountStatus: true,
        suspendedReason: true,
        createdAt: true,
      },
    });
    return updated;
  }

  return user;
}

export async function assertUserCanUsePlatform(userId: string): Promise<PlatformUser> {
  const user = await getPlatformUser(userId);
  if (!user) {
    throw new Error("User not found");
  }
  if (user.accountStatus === "suspended") {
    throw new HttpError(
      user.suspendedReason ?? "Your account is suspended. Contact support.",
      403
    );
  }
  return user;
}

export async function requireAdminUser(userId: string): Promise<PlatformUser> {
  const user = await getPlatformUser(userId);
  if (!user || user.role !== "admin") {
    throw new HttpError("Forbidden", 403);
  }
  return user;
}

export async function listUsersForAdmin(options?: { limit?: number; offset?: number }) {
  const limit = Math.min(options?.limit ?? 50, 100);
  const offset = options?.offset ?? 0;
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        accountStatus: true,
        suspendedReason: true,
        createdAt: true,
        _count: { select: { sites: true } },
      },
    }),
    prisma.user.count(),
  ]);
  return { users, total, limit, offset };
}

export async function updateUserAsAdmin(
  userId: string,
  patch: {
    role?: UserRole;
    accountStatus?: UserAccountStatus;
    suspendedReason?: string | null;
  }
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.accountStatus !== undefined ? { accountStatus: patch.accountStatus } : {}),
      ...(patch.suspendedReason !== undefined ? { suspendedReason: patch.suspendedReason } : {}),
      updatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      accountStatus: true,
      suspendedReason: true,
      createdAt: true,
    },
  });
}
