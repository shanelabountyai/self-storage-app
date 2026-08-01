-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "protectionRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "protection_plan" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coverageCents" INTEGER NOT NULL,
    "premiumCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protection_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protection_waiver" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT,
    "checkoutSessionId" TEXT,
    "tenantId" TEXT,
    "carrier" TEXT,
    "policyNumber" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "documentRef" TEXT,
    "overrideReason" TEXT,
    "overrideByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protection_waiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "protection_plan_facilityId_effectiveFrom_idx" ON "protection_plan"("facilityId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "protection_plan_facilityId_tier_effectiveFrom_key" ON "protection_plan"("facilityId", "tier", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "protection_waiver_leaseId_key" ON "protection_waiver"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "protection_waiver_checkoutSessionId_key" ON "protection_waiver"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "protection_waiver_facilityId_expiresAt_idx" ON "protection_waiver"("facilityId", "expiresAt");

-- AddForeignKey
ALTER TABLE "protection_plan" ADD CONSTRAINT "protection_plan_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protection_waiver" ADD CONSTRAINT "protection_waiver_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

