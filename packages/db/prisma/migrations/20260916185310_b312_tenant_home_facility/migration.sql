-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "facilityId" TEXT;

-- CreateIndex
CREATE INDEX "tenant_facilityId_idx" ON "tenant"("facilityId");

-- AddForeignKey
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
