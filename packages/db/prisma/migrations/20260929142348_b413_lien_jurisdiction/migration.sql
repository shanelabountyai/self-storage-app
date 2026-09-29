-- B-413. Every lien timeline and late-fee step is stamped with the state it
-- was written for, and an org default for either is bound to one state.
--
-- Rows that exist today are stamped TX (D-154): D-10 made Texas the
-- compliance default, and every default, seed and preset written before this
-- column was written as Texas. A facility in another state therefore reads as
-- a mismatch until somebody saves a timeline and a ladder for the state it is
-- in, which is the refusal this item exists to make.

-- AlterTable
ALTER TABLE "delinquency_timeline" ADD COLUMN     "jurisdiction" TEXT NOT NULL DEFAULT 'TX';

-- AlterTable
ALTER TABLE "late_fee_rule" ADD COLUMN     "jurisdiction" TEXT NOT NULL DEFAULT 'TX';

-- AlterTable
ALTER TABLE "org_default" ADD COLUMN     "jurisdiction" TEXT;

-- `fee_schedule` is not bound to a state and stays null.
UPDATE "org_default" SET "jurisdiction" = 'TX' WHERE "scope" IN ('late_fee_ladder', 'delinquency_timeline');
