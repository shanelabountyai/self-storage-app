-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "stripeRefundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payment_stripeRefundId_key" ON "payment"("stripeRefundId");
