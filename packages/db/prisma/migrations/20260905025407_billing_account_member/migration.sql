-- CreateTable
CREATE TABLE "billing_account_member" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_account_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_account_member_tenantId_idx" ON "billing_account_member"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_account_member_accountId_tenantId_key" ON "billing_account_member"("accountId", "tenantId");

-- AddForeignKey
ALTER TABLE "billing_account_member" ADD CONSTRAINT "billing_account_member_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "billing_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_account_member" ADD CONSTRAINT "billing_account_member_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
