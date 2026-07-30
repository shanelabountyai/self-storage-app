-- CreateEnum
CREATE TYPE "OperationalUnitStatus" AS ENUM ('available', 'maintenance', 'unrentable');

-- AlterTable
ALTER TABLE "unit" ADD COLUMN     "building" TEXT,
ADD COLUMN     "operationalStatus" "OperationalUnitStatus" NOT NULL DEFAULT 'available';

-- ---------------------------------------------------------------------------
-- Backfill operator intent from the existing effective status.
--
-- Without this every pre-existing unit would silently default to 'available',
-- including ones somebody had deliberately taken offline — exactly the
-- failure mode the two-column split exists to prevent. Units that are
-- occupied/reserved/overlocked have no recorded intent, so they correctly
-- fall to 'available': that is what they revert to when vacated.
-- ---------------------------------------------------------------------------
UPDATE "unit"
   SET "operationalStatus" = "status"::text::"OperationalUnitStatus"
 WHERE "status" IN ('available', 'maintenance', 'unrentable');

-- Grid view groups by building then floor (PRD 02 US-5).
CREATE INDEX "unit_facility_building_floor" ON "unit" ("facilityId", "building", "floor");
