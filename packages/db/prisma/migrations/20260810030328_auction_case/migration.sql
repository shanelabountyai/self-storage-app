-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('eligible', 'scheduled', 'sold', 'cancelled');

-- CreateEnum
CREATE TYPE "SurplusDisposition" AS ENUM ('no_surplus', 'held', 'claimed', 'remitted');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "surplusHoldDays" INTEGER NOT NULL DEFAULT 365;

-- CreateTable
CREATE TABLE "auction_case" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'eligible',
    "timelineId" TEXT,
    "containsVehicle" BOOLEAN NOT NULL DEFAULT false,
    "vehicleNote" TEXT,
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "scheduledSaleDate" DATE,
    "lockCutAt" TIMESTAMPTZ(6),
    "lockCutByStaffId" TEXT,
    "oldLockDisposition" TEXT,
    "inventoryDocumentId" TEXT,
    "soldAt" TIMESTAMPTZ(6),
    "grossProceedsCents" INTEGER,
    "saleCostsCents" INTEGER,
    "costsRecoveredCents" INTEGER,
    "appliedToLienCents" INTEGER,
    "surplusCents" INTEGER,
    "deficiencyCents" INTEGER,
    "buyerName" TEXT,
    "buyerAddressLine1" TEXT,
    "buyerAddressLine2" TEXT,
    "buyerCity" TEXT,
    "buyerState" TEXT,
    "buyerPostalCode" TEXT,
    "buyerGovernmentIdReference" TEXT,
    "buyerTaxExempt" BOOLEAN NOT NULL DEFAULT false,
    "buyerResaleCertificateReference" TEXT,
    "buyerPaymentMethod" TEXT,
    "buyerCleanoutDeadline" DATE,
    "buyerForfeitTerms" TEXT,
    "surplusDisposition" "SurplusDisposition" NOT NULL DEFAULT 'no_surplus',
    "surplusHoldUntil" DATE,
    "surplusTenantNotifiedAt" TIMESTAMPTZ(6),
    "surplusDispositionNote" TEXT,
    "surplusDispositionedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auction_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_advertisement" (
    "id" TEXT NOT NULL,
    "auctionCaseId" TEXT NOT NULL,
    "publication" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_advertisement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auction_case_facilityId_status_idx" ON "auction_case"("facilityId", "status");

-- CreateIndex
CREATE INDEX "auction_case_leaseId_idx" ON "auction_case"("leaseId");

-- CreateIndex
CREATE INDEX "auction_case_facilityId_surplusDisposition_idx" ON "auction_case"("facilityId", "surplusDisposition");

-- CreateIndex
CREATE INDEX "auction_advertisement_auctionCaseId_runDate_idx" ON "auction_advertisement"("auctionCaseId", "runDate");

-- AddForeignKey
ALTER TABLE "auction_case" ADD CONSTRAINT "auction_case_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_case" ADD CONSTRAINT "auction_case_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_case" ADD CONSTRAINT "auction_case_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_case" ADD CONSTRAINT "auction_case_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "delinquency_timeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_case" ADD CONSTRAINT "auction_case_inventoryDocumentId_fkey" FOREIGN KEY ("inventoryDocumentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_advertisement" ADD CONSTRAINT "auction_advertisement_auctionCaseId_fkey" FOREIGN KEY ("auctionCaseId") REFERENCES "auction_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One LIVE lien-sale case per lease. Prisma cannot express a partial unique
-- index, so it lives here — the same device as
-- `unit_overlock_one_live_per_unit` (B-058) and
-- `delinquency_step_run_open_episode` (B-057).
--
-- Partial on the live statuses rather than a plain unique on leaseId, because
-- a lease that cured and later fell behind again must be able to start a
-- second case. What must never happen is two OPEN cases against the same
-- lease: two managers scheduling two sales of the same unit.
CREATE UNIQUE INDEX "auction_case_one_live_per_lease"
  ON "auction_case" ("leaseId")
  WHERE "status" IN ('eligible', 'scheduled');
