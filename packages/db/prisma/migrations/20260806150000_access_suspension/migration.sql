-- B-098 / PRD 02 §4.6 US-45, decided as D-16. The single access threshold.
ALTER TABLE "facility"
  ADD COLUMN "accessSuspendDaysPastDue" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "accessRestoreAtOrBelowCents" INTEGER NOT NULL DEFAULT 0;
