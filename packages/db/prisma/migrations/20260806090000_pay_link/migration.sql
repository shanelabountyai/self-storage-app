-- B-051 / PRD 05 CN-4, FR-12. One-tap pay links.

-- CreateTable
CREATE TABLE "pay_link" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "eventId" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "firstClickedAt" TIMESTAMPTZ(6),
    "lastClickedAt" TIMESTAMPTZ(6),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "paymentId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the token is looked up by hash on every click, and the
-- plaintext is never stored.
CREATE UNIQUE INDEX "pay_link_tokenHash_key" ON "pay_link"("tokenHash");

-- CreateIndex: one payment is attributed to at most one link.
CREATE UNIQUE INDEX "pay_link_paymentId_key" ON "pay_link"("paymentId");

-- CreateIndex
CREATE INDEX "pay_link_leaseId_expiresAt_idx" ON "pay_link"("leaseId", "expiresAt");
CREATE INDEX "pay_link_eventId_idx" ON "pay_link"("eventId");

-- AddForeignKey
ALTER TABLE "pay_link" ADD CONSTRAINT "pay_link_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pay_link" ADD CONSTRAINT "pay_link_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pay_link" ADD CONSTRAINT "pay_link_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
