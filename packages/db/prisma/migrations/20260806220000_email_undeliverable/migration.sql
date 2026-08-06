-- B-054 / PRD 05 FR-15. The tenant flag a hard bounce or complaint sets.
--
-- A flag rather than clearing the address: the address is still what we last
-- had, and losing it would make "which address did we write to" unanswerable.
ALTER TABLE "tenant"
  ADD COLUMN "emailUndeliverableAt" TIMESTAMPTZ(6);
