-- B-043 / D-17. Per-facility policy for a lapsed proof of insurance.
-- `auto_enrol_protection_on_lapse` defaults to false: the behaviour is built,
-- but D-17 records that it warrants an attorney pass before it charges a real
-- tenant, so the switch is thrown deliberately per facility.
ALTER TABLE "facility"
  ADD COLUMN "autoEnrolProtectionOnLapse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultProtectionTier" TEXT;
