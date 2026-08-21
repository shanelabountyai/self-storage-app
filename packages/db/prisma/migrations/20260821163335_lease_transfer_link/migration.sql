-- AlterTable
ALTER TABLE "lease" ADD COLUMN     "transferredFromLeaseId" TEXT;

-- CreateIndex
CREATE INDEX "lease_transferredFromLeaseId_idx" ON "lease"("transferredFromLeaseId");

-- AddForeignKey
ALTER TABLE "lease" ADD CONSTRAINT "lease_transferredFromLeaseId_fkey" FOREIGN KEY ("transferredFromLeaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
