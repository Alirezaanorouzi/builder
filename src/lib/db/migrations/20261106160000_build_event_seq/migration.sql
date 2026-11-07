-- AlterTable
ALTER TABLE "BuildEvent" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "BuildEvent_buildRunId_seq_idx" ON "BuildEvent"("buildRunId", "seq");

-- CreateIndex
CREATE INDEX "BuildEvent_createdAt_idx" ON "BuildEvent"("createdAt");
