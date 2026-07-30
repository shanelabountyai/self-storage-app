-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('admin', 'late', 'nsf', 'lien');

-- CreateTable
CREATE TABLE "tax_component" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedule" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "feeType" "FeeType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_component_facilityId_jurisdiction_effectiveFrom_idx" ON "tax_component"("facilityId", "jurisdiction", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "tax_component_facilityId_jurisdiction_effectiveFrom_key" ON "tax_component"("facilityId", "jurisdiction", "effectiveFrom");

-- CreateIndex
CREATE INDEX "fee_schedule_facilityId_feeType_effectiveFrom_idx" ON "fee_schedule"("facilityId", "feeType", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedule_facilityId_feeType_effectiveFrom_key" ON "fee_schedule"("facilityId", "feeType", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "tax_component" ADD CONSTRAINT "tax_component_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Facility settings invariants.
-- ---------------------------------------------------------------------------

-- Basis points are hundredths of a percent (825 = 8.25%). Negative makes no
-- sense and >100% (10000 bps) would be a data-entry error, not a real rate.
ALTER TABLE "tax_component"
    ADD CONSTRAINT "tax_component_rate_range"
    CHECK ("rateBasisPoints" >= 0 AND "rateBasisPoints" <= 10000);

ALTER TABLE "fee_schedule"
    ADD CONSTRAINT "fee_schedule_amount_non_negative"
    CHECK ("amountCents" >= 0);
