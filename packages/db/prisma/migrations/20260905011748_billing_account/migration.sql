-- AlterTable
ALTER TABLE "lease" ADD COLUMN     "billingAccountId" TEXT;

-- CreateTable
CREATE TABLE "billing_account" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payerTenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_account_payerTenantId_idx" ON "billing_account"("payerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_account_facilityId_name_key" ON "billing_account"("facilityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "billing_account_id_facilityId_key" ON "billing_account"("id", "facilityId");

-- CreateIndex
CREATE INDEX "lease_billingAccountId_idx" ON "lease"("billingAccountId");

-- AddForeignKey
ALTER TABLE "lease" ADD CONSTRAINT "lease_billingAccountId_facilityId_fkey" FOREIGN KEY ("billingAccountId", "facilityId") REFERENCES "billing_account"("id", "facilityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_account" ADD CONSTRAINT "billing_account_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_account" ADD CONSTRAINT "billing_account_payerTenantId_fkey" FOREIGN KEY ("payerTenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
