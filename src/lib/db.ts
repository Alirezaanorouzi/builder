import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1002", "P1017", "P2024"]);

export function isTransientPrismaError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return TRANSIENT_PRISMA_CODES.has(String((error as { code: string }).code));
}

export async function reconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  await prisma.$connect();
}

/** Retry once after reconnect — helps remote Postgres (e.g. Liara) dropping idle connections. */
export async function withDbRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      if (!isTransientPrismaError(e) || i === attempts - 1) throw e;
      await reconnectPrisma();
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastError;
}
