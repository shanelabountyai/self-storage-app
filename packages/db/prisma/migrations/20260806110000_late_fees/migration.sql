-- B-047 / PRD 02 US-21. Late fee schedule and the wider fee catalogue.

-- AlterEnum: the fees a facility actually charges. Uncharged lock-cut and
-- cleaning is $50–75 per move-out, and a fee with nowhere to post is a fee
-- nobody charges.
ALTER TYPE "FeeType" ADD VALUE 'lock_cut';
ALTER TYPE "FeeType" ADD VALUE 'cleaning';
ALTER TYPE "FeeType" ADD VALUE 'damage';
ALTER TYPE "FeeType" ADD VALUE 'transfer';
ALTER TYPE "FeeType" ADD VALUE 'certified_mail';
ALTER TYPE "FeeType" ADD VALUE 'auction_cost';

-- CreateEnum
CREATE TYPE "LateFeeBasis" AS ENUM ('flat', 'percent', 'greater', 'lesser');
CREATE TYPE "InvoiceKind" AS ENUM ('rent', 'fee');

-- AlterTable: a fee invoice must never become the base for another late fee,
-- or a facility charges fees on fees and the balance compounds on its own.
ALTER TABLE "invoice"
  ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'rent';

-- CreateTable: one row per step of a facility's late-fee ladder, effective-
-- dated per step so changing the second fee leaves the first alone.
CREATE TABLE "late_fee_rule" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "daysPastDue" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "percentBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "basis" "LateFeeBasis" NOT NULL DEFAULT 'flat',
    "capCents" INTEGER,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "late_fee_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_rule_facilityId_step_effectiveFrom_key" ON "late_fee_rule"("facilityId", "step", "effectiveFrom");
CREATE INDEX "late_fee_rule_facilityId_effectiveFrom_idx" ON "late_fee_rule"("facilityId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "late_fee_rule" ADD CONSTRAINT "late_fee_rule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
