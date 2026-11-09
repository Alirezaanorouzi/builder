-- CreateTable
CREATE TABLE "UserUsage" (
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL DEFAULT 'free',
    "phase" INTEGER NOT NULL DEFAULT 0,
    "windowUnits" BIGINT NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastUsageAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserUsage_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RunUsage" (
    "buildRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "units" BIGINT NOT NULL DEFAULT 0,
    "appliedUnits" BIGINT NOT NULL DEFAULT 0,
    "tokens" JSONB,
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "nextSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunUsage_pkey" PRIMARY KEY ("buildRunId")
);

-- CreateIndex
CREATE INDEX "RunUsage_nextSyncAt_idx" ON "RunUsage"("nextSyncAt");

-- CreateIndex
CREATE INDEX "RunUsage_userId_createdAt_idx" ON "RunUsage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserUsage" ADD CONSTRAINT "UserUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunUsage" ADD CONSTRAINT "RunUsage_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunUsage" ADD CONSTRAINT "RunUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
