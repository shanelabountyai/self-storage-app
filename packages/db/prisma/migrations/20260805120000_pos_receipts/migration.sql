-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "cashApprovalThresholdCents" INTEGER NOT NULL DEFAULT 50000;

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "receivedByStaffId" TEXT,
                      ADD COLUMN     "receiptNumber" INTEGER;

-- CreateTable
CREATE TABLE "receipt_counter" (
    "facilityId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receipt_counter_pkey" PRIMARY KEY ("facilityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_facilityId_receiptNumber_key" ON "payment"("facilityId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_receivedByStaffId_fkey" FOREIGN KEY ("receivedByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_counter" ADD CONSTRAINT "receipt_counter_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
