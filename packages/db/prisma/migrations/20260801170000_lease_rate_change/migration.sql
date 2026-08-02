-- CreateEnum
CREATE TYPE "LeaseRateReason" AS ENUM ('move_in', 'ecri', 'transfer', 'promo_expiry', 'manual');

-- CreateTable
CREATE TABLE "lease_rate_change" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "previousRateCents" INTEGER,
    "newRateCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "reason" "LeaseRateReason" NOT NULL,
    "actorStaffId" TEXT,
    "noticeDays" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_rate_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lease_rate_change_leaseId_effectiveFrom_idx" ON "lease_rate_change"("leaseId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "lease_rate_change" ADD CONSTRAINT "lease_rate_change_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

