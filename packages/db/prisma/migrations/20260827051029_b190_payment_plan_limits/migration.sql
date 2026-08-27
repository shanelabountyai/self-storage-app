-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "planGraceDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "planMaxDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "planMaxPerRollingYear" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "role" ADD COLUMN     "maxPlanDeferralCents" INTEGER;

-- D-98 (B-190). `maxPlanDeferralCents` is nullable BECAUSE null means
-- unlimited, which is right for `owner` and catastrophically wrong for
-- everybody else — a bare ADD COLUMN would hand every counter staffer the
-- authority to defer any balance until the next seed run. The seeded values go
-- in here so the migration alone is safe, matching `packages/db/rbac-catalog.ts`.
UPDATE "role" SET "maxPlanDeferralCents" = CASE "key"
  WHEN 'manager'  THEN 200000
  WHEN 'regional' THEN 1000000
  WHEN 'owner'    THEN NULL
  ELSE 0
END;
