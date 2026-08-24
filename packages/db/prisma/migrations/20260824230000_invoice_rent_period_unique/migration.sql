-- B-167. The (leaseId, periodStart) uniqueness is the RENT generator's
-- idempotency key and was never anything else's. Unscoped it capped a lease at
-- one fee invoice per calendar day, so a move-out charging cleaning and damage
-- on the same afternoon lost the second silently, and an NSF fee raised on a
-- day that already had a late fee threw an unhandled unique violation.
--
-- Partial unique index in raw SQL because Prisma cannot express one — the same
-- device as reservation_one_held_per_unit and
-- delinquency_step_run_open_episode.
DROP INDEX "invoice_leaseId_periodStart_key";

CREATE UNIQUE INDEX "invoice_one_rent_per_period"
  ON "invoice" ("leaseId", "periodStart")
  WHERE "kind" = 'rent';
