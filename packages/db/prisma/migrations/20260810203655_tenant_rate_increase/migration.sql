-- CreateEnum
CREATE TYPE "RateIncreaseStatus" AS ENUM ('pending_approval', 'approved', 'notice_sent', 'applied', 'cancelled');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "rateIncreaseNoticeDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "lease_rate_change" ADD COLUMN     "rateIncreaseId" TEXT;

-- CreateTable
CREATE TABLE "tenant_rate_increase" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "currentRateCents" INTEGER NOT NULL,
    "newRateCents" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "noticeDate" DATE NOT NULL,
    "noticeDays" INTEGER NOT NULL,
    "status" "RateIncreaseStatus" NOT NULL DEFAULT 'pending_approval',
    "batchId" TEXT,
    "createdByStaffId" TEXT,
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "noticeSentAt" TIMESTAMPTZ(6),
    "appliedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_rate_increase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_rate_increase_facilityId_status_idx" ON "tenant_rate_increase"("facilityId", "status");

-- CreateIndex
CREATE INDEX "tenant_rate_increase_leaseId_idx" ON "tenant_rate_increase"("leaseId");

-- CreateIndex
CREATE INDEX "tenant_rate_increase_status_effectiveDate_idx" ON "tenant_rate_increase"("status", "effectiveDate");

-- CreateIndex
CREATE INDEX "tenant_rate_increase_status_noticeDate_idx" ON "tenant_rate_increase"("status", "noticeDate");

-- AddForeignKey
ALTER TABLE "lease_rate_change" ADD CONSTRAINT "lease_rate_change_rateIncreaseId_fkey" FOREIGN KEY ("rateIncreaseId") REFERENCES "tenant_rate_increase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_rate_increase" ADD CONSTRAINT "tenant_rate_increase_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_rate_increase" ADD CONSTRAINT "tenant_rate_increase_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
