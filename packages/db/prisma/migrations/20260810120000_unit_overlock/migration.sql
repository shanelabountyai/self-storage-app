-- B-058 / PRD 03 US-3 AC1, PRD 02 US-25. The record that a unit is overlocked.
--
-- The lock is physical and manual — PRD 03's non-goals say this system never
-- actuates one — so this row is the evidence staff fitted it, and the fact
-- `deriveUnitStatus` reads to make a unit `overlocked`. That status has existed
-- in the enum since B-010 with nothing producing it.
--
-- Removal sets `removedAt` rather than deleting, for the same reason the
-- delinquency step history is superseded rather than dropped: "was this unit
-- locked on the day of the sale" is a question an auction turns on.
CREATE TABLE "unit_overlock" (
  "id"               TEXT NOT NULL,
  "unitId"           TEXT NOT NULL,
  "leaseId"          TEXT NOT NULL,
  "facilityId"       TEXT NOT NULL,
  "appliedTaskId"    TEXT,
  "appliedAt"        TIMESTAMPTZ(6),
  "appliedByStaffId" TEXT,
  "removedTaskId"    TEXT,
  "removedAt"        TIMESTAMPTZ(6),
  "removedByStaffId" TEXT,
  "reason"           TEXT NOT NULL,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_overlock_pkey" PRIMARY KEY ("id")
);

-- One LIVE overlock per unit. Partial, so the history of previous locks on the
-- same unit is kept — the same device as reservation_one_held_per_unit and
-- delinquency_step_run_open_episode.
CREATE UNIQUE INDEX "unit_overlock_one_live_per_unit"
  ON "unit_overlock" ("unitId") WHERE "removedAt" IS NULL;

CREATE INDEX "unit_overlock_facilityId_removedAt_idx" ON "unit_overlock" ("facilityId", "removedAt");
CREATE INDEX "unit_overlock_leaseId_idx" ON "unit_overlock" ("leaseId");

ALTER TABLE "unit_overlock"
  ADD CONSTRAINT "unit_overlock_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "unit_overlock_leaseId_fkey"
  FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "unit_overlock_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
