-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "paymentPlanInstallmentId" TEXT;

-- AlterTable
ALTER TABLE "payment_plan" ADD COLUMN     "autoCollect" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "payment_paymentPlanInstallmentId_idx" ON "payment"("paymentPlanInstallmentId");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_paymentPlanInstallmentId_fkey" FOREIGN KEY ("paymentPlanInstallmentId") REFERENCES "payment_plan_installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
