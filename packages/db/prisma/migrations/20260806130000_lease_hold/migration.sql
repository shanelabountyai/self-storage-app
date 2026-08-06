-- B-096 / PRD 02 §4.4 US-42. Lease holds.
--
-- `type` is TEXT rather than an enum: US-42 requires that adding a hold type be
-- a configuration change, and the effects live in packages/core/holds. An enum
-- here would make every new type a migration.

CREATE TABLE "lease_hold" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL,
    "documentId" TEXT,
    "placedByStaffId" TEXT NOT NULL,
    "liftedAt" TIMESTAMPTZ(6),
    "liftedByStaffId" TEXT,
    "liftReason" TEXT,
    "estateContactName" TEXT,
    "estateContactPhone" TEXT,
    "estateContactEmail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_hold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lease_hold_leaseId_liftedAt_idx" ON "lease_hold"("leaseId", "liftedAt");

ALTER TABLE "lease_hold" ADD CONSTRAINT "lease_hold_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lease_hold" ADD CONSTRAINT "lease_hold_placedByStaffId_fkey" FOREIGN KEY ("placedByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lease_hold" ADD CONSTRAINT "lease_hold_liftedByStaffId_fkey" FOREIGN KEY ("liftedByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
