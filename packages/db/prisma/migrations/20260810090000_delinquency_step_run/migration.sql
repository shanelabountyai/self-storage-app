-- B-057 / PRD 02 FR-5, US-28. One row per timeline step executed against one
-- lease.
--
-- This is the step history an auction has to be defensible from — "each step,
-- date executed, proof" — and it is what makes the nightly run idempotent: the
-- unique constraint is the reason a catch-up over a missed week cannot send the
-- day-15 notice seven times.
CREATE TABLE "delinquency_step_run" (
  "id"           TEXT NOT NULL,
  "leaseId"      TEXT NOT NULL,
  "facilityId"   TEXT NOT NULL,
  "timelineId"   TEXT NOT NULL,
  "dayOffset"    INTEGER NOT NULL,
  "label"        TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "taskId"       TEXT,
  "outcome"      JSONB,
  "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delinquency_step_run_pkey" PRIMARY KEY ("id")
);

-- One execution of one step per lease, ever — not per business date, because a
-- step is a point in a pipeline and re-running the night it fired must not fire
-- it again.
CREATE UNIQUE INDEX "delinquency_step_run_leaseId_dayOffset_key"
  ON "delinquency_step_run" ("leaseId", "dayOffset");
CREATE INDEX "delinquency_step_run_facilityId_businessDate_idx"
  ON "delinquency_step_run" ("facilityId", "businessDate");

ALTER TABLE "delinquency_step_run"
  ADD CONSTRAINT "delinquency_step_run_leaseId_fkey"
  FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "delinquency_step_run_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "delinquency_step_run_timelineId_fkey"
  FOREIGN KEY ("timelineId") REFERENCES "delinquency_timeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
