-- CreateTable
CREATE TABLE "protection_change" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "fromPlanName" TEXT,
    "fromPremiumCents" INTEGER NOT NULL,
    "toPlanName" TEXT,
    "toTier" TEXT,
    "toPremiumCents" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "requestedByTenantId" TEXT,
    "requestedByStaffId" TEXT,
    "appliedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protection_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "protection_change_facilityId_effectiveFrom_idx" ON "protection_change"("facilityId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "protection_change_leaseId_appliedAt_idx" ON "protection_change"("leaseId", "appliedAt");

-- AddForeignKey
ALTER TABLE "protection_change" ADD CONSTRAINT "protection_change_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protection_change" ADD CONSTRAINT "protection_change_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
