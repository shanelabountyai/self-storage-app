-- B-406 follow-up. `lastVacantCheckAt` was added as TIMESTAMP(3); every other
-- timestamp here is TIMESTAMPTZ(6) (tests/schema-invariants.test.ts).
-- Prisma wrote the existing values as UTC wall-clock time, so they are read
-- back AS UTC — a bare cast would read them in the session's time zone.
ALTER TABLE "unit"
  ALTER COLUMN "lastVacantCheckAt" SET DATA TYPE TIMESTAMPTZ(6)
  USING "lastVacantCheckAt" AT TIME ZONE 'UTC';
