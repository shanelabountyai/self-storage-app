-- B-406. Additive: a per-facility sample size and a per-unit last-verified stamp.
ALTER TABLE "facility" ADD COLUMN "vacantCheckSample" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "unit" ADD COLUMN "lastVacantCheckAt" TIMESTAMP(3);
