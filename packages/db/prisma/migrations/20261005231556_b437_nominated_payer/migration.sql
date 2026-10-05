-- AlterTable
ALTER TABLE "pay_link" ADD COLUMN     "nominatedPayerId" TEXT;

-- CreateTable
CREATE TABLE "nominated_payer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "disclosureVersion" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "consentedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMPTZ(6),
    "removedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nominated_payer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nominated_payer_tenantId_idx" ON "nominated_payer"("tenantId");

-- AddForeignKey
ALTER TABLE "pay_link" ADD CONSTRAINT "pay_link_nominatedPayerId_fkey" FOREIGN KEY ("nominatedPayerId") REFERENCES "nominated_payer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nominated_payer" ADD CONSTRAINT "nominated_payer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
