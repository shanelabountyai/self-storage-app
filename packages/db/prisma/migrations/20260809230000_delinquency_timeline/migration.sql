-- B-056 / PRD 02 §4.6 US-25, US-29. The delinquency timeline, versioned.
--
-- Append-only, like message templates and tax components: activating a new
-- configuration inserts a version and deactivates the previous one. Nothing is
-- edited in place, because the lease records which version governed it — and a
-- lien file whose timeline has been rewritten since cannot be defended.
CREATE TABLE "delinquency_timeline" (
  "id"               TEXT NOT NULL,
  "facilityId"       TEXT NOT NULL,
  "version"          INTEGER NOT NULL,
  "active"           BOOLEAN NOT NULL DEFAULT false,
  "label"            TEXT NOT NULL,
  "qualifyingAmount" TEXT NOT NULL DEFAULT 'full_balance',
  "steps"            JSONB NOT NULL,
  "createdByStaffId" TEXT,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delinquency_timeline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delinquency_timeline_facilityId_version_key"
  ON "delinquency_timeline" ("facilityId", "version");
CREATE INDEX "delinquency_timeline_facilityId_active_idx"
  ON "delinquency_timeline" ("facilityId", "active");

ALTER TABLE "delinquency_timeline"
  ADD CONSTRAINT "delinquency_timeline_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "delinquency_timeline_createdByStaffId_fkey"
  FOREIGN KEY ("createdByStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- US-25's AC: "the lease records which timeline version governed it." Pinned
-- when the lease first goes delinquent (B-057), not at move-in: a lease that
-- never goes past due is governed by nothing.
ALTER TABLE "lease" ADD COLUMN "delinquencyTimelineId" TEXT;
ALTER TABLE "lease"
  ADD CONSTRAINT "lease_delinquencyTimelineId_fkey"
  FOREIGN KEY ("delinquencyTimelineId") REFERENCES "delinquency_timeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
