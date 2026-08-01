-- CreateEnum
CREATE TYPE "CheckoutStep" AS ENUM ('details', 'unit_assign', 'insurance', 'lease', 'payment', 'provisioned');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('active', 'completed', 'expired', 'abandoned');

-- CreateTable
CREATE TABLE "checkout_session" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitTypeId" TEXT NOT NULL,
    "unitId" TEXT,
    "reservationId" TEXT,
    "tenantId" TEXT,
    "step" "CheckoutStep" NOT NULL DEFAULT 'details',
    "status" "CheckoutStatus" NOT NULL DEFAULT 'active',
    "tokenHash" TEXT NOT NULL,
    "email" TEXT,
    "quotedRateCents" INTEGER NOT NULL,
    "lockExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checkout_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_session_tokenHash_key" ON "checkout_session"("tokenHash");

-- CreateIndex
CREATE INDEX "checkout_session_facilityId_status_idx" ON "checkout_session"("facilityId", "status");

-- CreateIndex
CREATE INDEX "checkout_session_status_lockExpiresAt_idx" ON "checkout_session"("status", "lockExpiresAt");

-- AddForeignKey
ALTER TABLE "checkout_session" ADD CONSTRAINT "checkout_session_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session" ADD CONSTRAINT "checkout_session_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session" ADD CONSTRAINT "checkout_session_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session" ADD CONSTRAINT "checkout_session_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session" ADD CONSTRAINT "checkout_session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- B-020. One live checkout may hold a given unit, for the same reason one live
-- reservation may (B-018): the service claims a unit with FOR UPDATE SKIP
-- LOCKED, and this is what rejects the write if a future code path ever skips
-- that. Partial over active-with-a-unit so completed, expired and abandoned
-- sessions stay queryable — B-073's abandonment follow-up reads them, and they
-- are the record of what the renter had chosen.
CREATE UNIQUE INDEX "checkout_session_one_active_per_unit"
    ON "checkout_session" ("unitId")
    WHERE "status" = 'active' AND "unitId" IS NOT NULL;
