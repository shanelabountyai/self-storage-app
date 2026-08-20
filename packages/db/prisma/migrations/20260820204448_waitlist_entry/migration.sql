-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('waiting', 'notified', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "waitlist_entry" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitTypeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "firstName" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'waiting',
    "notifiedAt" TIMESTAMPTZ(6),
    "cancelToken" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "waitlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entry_cancelToken_key" ON "waitlist_entry"("cancelToken");

-- CreateIndex
CREATE INDEX "waitlist_entry_unitTypeId_status_createdAt_idx" ON "waitlist_entry"("unitTypeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "waitlist_entry_facilityId_status_idx" ON "waitlist_entry"("facilityId", "status");

-- CreateIndex
CREATE INDEX "waitlist_entry_email_idx" ON "waitlist_entry"("email");

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One LIVE entry per address per unit type, enforced here rather than only in
-- the service. Same device as `reservation_one_held_per_unit`: the service
-- reads before it writes, and a double-submitted form — or two tabs — both
-- pass that read. Partial over the live states so a prospect who cancelled, or
-- whose claim window expired, may join the list again later.
--
-- `lower(email)` because an address is case-insensitive in practice and
-- "Ada@example.com" joining twice as "ada@example.com" is the same person
-- getting two mails about one unit.
CREATE UNIQUE INDEX "waitlist_one_live_entry_per_email_per_type"
    ON "waitlist_entry" ("unitTypeId", lower("email"))
    WHERE "status" IN ('waiting', 'notified');
