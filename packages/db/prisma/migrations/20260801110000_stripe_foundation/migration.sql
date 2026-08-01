-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeDefaultPaymentMethodId" TEXT;

-- CreateTable
CREATE TABLE "stripe_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(6),
    "error" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stripe_event_processedAt_idx" ON "stripe_event"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_stripeCustomerId_key" ON "tenant"("stripeCustomerId");

