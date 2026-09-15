-- B-304. An acknowledged ledger exception.
--
-- B-277's sweep raises a HIGH-priority task per facility per business day while
-- anything there fails to reconcile, and B-292 named two shapes that failed for
-- ever. A task that cannot be closed and returns tomorrow is how a team learns
-- to ignore high-priority tasks, which is worse than not having the sweep and
-- degrades every other alarm B-229 built.
--
-- One row per lease (hence the unique), replaced when it is acknowledged again.
-- `differenceCents` is what makes it an acknowledgement rather than a mute: a
-- discrepancy that changes size is a new fact, and the sweep ignores a row whose
-- figure no longer matches.
CREATE TABLE "ledger_exception_acknowledgement" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "differenceCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "acknowledgedById" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_exception_acknowledgement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_exception_acknowledgement_leaseId_key"
  ON "ledger_exception_acknowledgement"("leaseId");

CREATE INDEX "ledger_exception_acknowledgement_facilityId_idx"
  ON "ledger_exception_acknowledgement"("facilityId");

ALTER TABLE "ledger_exception_acknowledgement"
  ADD CONSTRAINT "ledger_exception_acknowledgement_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE on the lease and RESTRICT on the other two: the judgement is about
-- THIS lease and means nothing without it, while a facility or a staff user
-- that an acknowledgement names must not be deletable out from under it.
ALTER TABLE "ledger_exception_acknowledgement"
  ADD CONSTRAINT "ledger_exception_acknowledgement_leaseId_fkey"
  FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ledger_exception_acknowledgement"
  ADD CONSTRAINT "ledger_exception_acknowledgement_acknowledgedById_fkey"
  FOREIGN KEY ("acknowledgedById") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
