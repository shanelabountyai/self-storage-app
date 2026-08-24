-- AlterTable
ALTER TABLE "tenant_rate_increase" ADD COLUMN     "renoticedFromId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tenant_rate_increase_renoticedFromId_key" ON "tenant_rate_increase"("renoticedFromId");

-- AddForeignKey
ALTER TABLE "tenant_rate_increase" ADD CONSTRAINT "tenant_rate_increase_renoticedFromId_fkey" FOREIGN KEY ("renoticedFromId") REFERENCES "tenant_rate_increase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

