-- B-052 / PRD 05 CN-3. The past-due dunning ladder, per facility.
ALTER TABLE "facility"
  ADD COLUMN "dunningDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 5, 10, 30];
