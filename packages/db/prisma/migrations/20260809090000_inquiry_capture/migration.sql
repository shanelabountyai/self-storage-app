-- B-097 / PRD 02 US-43. Phone and counter inquiry capture.

-- The half of rentals that start on the phone. Today they land on a sticky
-- note, and the lead-to-rental report shows only web leads and looks excellent.
ALTER TABLE "lead"
  ADD COLUMN "targetMoveInDate" DATE,
  ADD COLUMN "contactedAt"      TIMESTAMPTZ(6),
  ADD COLUMN "createdByStaffId" TEXT;

CREATE INDEX "lead_facilityId_contactedAt_idx" ON "lead" ("facilityId", "contactedAt");
ALTER TABLE "lead"
  ADD CONSTRAINT "lead_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The acquisition channel, distinct from UTM campaign attribution: utmSource
-- describes a click, and says nothing about a phone call.
ALTER TABLE "reservation" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'web';

-- Denormalised onto the lease: the chain that knows the answer is three
-- nullable joins long, so a report walking it would silently under-count the
-- channels this exists to measure. NULL means the lease predates capture, which
-- reports as `unknown` rather than being folded into `web`.
ALTER TABLE "lease" ADD COLUMN "acquisitionSource" TEXT;

-- US-43: a lead uncontacted past this window becomes a follow-up task.
ALTER TABLE "facility" ADD COLUMN "leadFollowUpHours" INTEGER NOT NULL DEFAULT 4;
