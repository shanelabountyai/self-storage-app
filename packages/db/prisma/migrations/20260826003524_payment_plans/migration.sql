-- CreateEnum
CREATE TYPE "PaymentPlanStatus" AS ENUM ('active', 'completed', 'broken', 'cancelled');

-- CreateTable
CREATE TABLE "payment_plan" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "status" "PaymentPlanStatus" NOT NULL DEFAULT 'active',
    "totalCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "brokenAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledByStaffId" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "payment_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_plan_installment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "dueDate" TIMESTAMPTZ(6) NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "payment_plan_installment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_plan_holdId_key" ON "payment_plan"("holdId");

-- CreateIndex
CREATE INDEX "payment_plan_leaseId_status_idx" ON "payment_plan"("leaseId", "status");

-- CreateIndex
CREATE INDEX "payment_plan_installment_planId_idx" ON "payment_plan_installment"("planId");

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "lease_hold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_cancelledByStaffId_fkey" FOREIGN KEY ("cancelledByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan_installment" ADD CONSTRAINT "payment_plan_installment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "payment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
