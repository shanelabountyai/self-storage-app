-- B-057. A cured tenant's step history is KEPT, not deleted.
--
-- The first cut of the engine deleted the runs on cure so a later delinquency
-- could start over. That destroys the evidence US-28 requires an auction to be
-- defended from — "each step, date executed, proof" — which is the entire
-- reason this table exists rather than an event payload.
--
-- Instead the rows are superseded: they stay, and stop counting as executed.
ALTER TABLE "delinquency_step_run" ADD COLUMN "supersededAt" TIMESTAMPTZ(6);

-- The idempotency key becomes a PARTIAL unique index, scoped to the open
-- episode. A plain unique(leaseId, dayOffset) would let a lease be chased
-- exactly once in its life: cure, fall behind again, and day 1 could never fire
-- because a superseded row still occupied the key.
--
-- Same device, and the same reason, as reservation_one_held_per_unit.
DROP INDEX IF EXISTS "delinquency_step_run_leaseId_dayOffset_key";

CREATE UNIQUE INDEX "delinquency_step_run_open_episode"
  ON "delinquency_step_run" ("leaseId", "dayOffset")
  WHERE "supersededAt" IS NULL;

CREATE INDEX "delinquency_step_run_leaseId_supersededAt_idx"
  ON "delinquency_step_run" ("leaseId", "supersededAt");
