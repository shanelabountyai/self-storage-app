-- B-044 / PRD 02 US-17, US-18. Recurring invoice generation.

-- CreateEnum
CREATE TYPE "BillingPolicy" AS ENUM ('anniversary', 'first_of_month');

-- AlterTable: per-facility billing policy. Anniversary is the default (D-27) —
-- the move-in payment buys a full period starting that day, so nothing is
-- prorated on the way in and the tenant's due date never moves.
ALTER TABLE "facility"
  ADD COLUMN "billingPolicy" "BillingPolicy" NOT NULL DEFAULT 'anniversary',
  ADD COLUMN "invoiceLeadDays" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "prorateOnMoveIn" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: the service period an invoice bills, half-open. NOT NULL with no
-- default on purpose — nothing has ever written an invoice row, and if
-- something had, a silent default would date it to the epoch rather than
-- failing loudly here.
ALTER TABLE "invoice"
  ADD COLUMN "periodStart" DATE NOT NULL,
  ADD COLUMN "periodEnd" DATE NOT NULL;

-- CreateIndex: the generator's idempotency key. A database constraint rather
-- than a check-then-insert, because the nightly run is re-runnable and catches
-- up missed dates (FR-4).
CREATE UNIQUE INDEX "invoice_leaseId_periodStart_key" ON "invoice"("leaseId", "periodStart");

-- CreateTable: gapless sequential invoice numbers per facility (US-17), the
-- same row-lock counter as receipt_counter (D-22). A Postgres sequence is
-- unique but not gapless — a rolled-back transaction never returns its number.
CREATE TABLE "invoice_counter" (
    "facilityId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_counter_pkey" PRIMARY KEY ("facilityId")
);

-- AddForeignKey
ALTER TABLE "invoice_counter" ADD CONSTRAINT "invoice_counter_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
