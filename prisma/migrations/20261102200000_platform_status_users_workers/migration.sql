-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('active', 'suspended');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user',
ADD COLUMN     "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "suspendReason" TEXT;

-- AlterTable
ALTER TABLE "SiteResources" ADD COLUMN     "provisioningAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "provisioningLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "provisioningWorkerId" TEXT;

-- CreateTable
CREATE TABLE "SiteStatusEvent" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "fromStatus" "SiteStatus",
    "toStatus" "SiteStatus" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_accountStatus_idx" ON "User"("accountStatus");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Site_status_statusChangedAt_idx" ON "Site"("status", "statusChangedAt");

-- CreateIndex
CREATE INDEX "SiteResources_provisioningStep_idx" ON "SiteResources"("provisioningStep");

-- CreateIndex
CREATE INDEX "SiteResources_provisioningLeaseUntil_idx" ON "SiteResources"("provisioningLeaseUntil");

-- CreateIndex
CREATE INDEX "SiteStatusEvent_siteId_createdAt_idx" ON "SiteStatusEvent"("siteId", "createdAt");

-- AddForeignKey
ALTER TABLE "SiteStatusEvent" ADD CONSTRAINT "SiteStatusEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
