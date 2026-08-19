-- CreateTable
CREATE TABLE "unit_status_history" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_status_history_facilityId_effectiveFrom_idx" ON "unit_status_history"("facilityId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "unit_status_history_unitId_effectiveFrom_idx" ON "unit_status_history"("unitId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "unit_status_history" ADD CONSTRAINT "unit_status_history_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_status_history" ADD CONSTRAINT "unit_status_history_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- B-131. Record every change to a unit's derived status, from the database.
--
-- Why a trigger and not application code: `Unit.status` is derived, and it has
-- two writers today (`recomputeUnitStatus`, and the bulk status operation's
-- pre-evaluated `to`), plus the seed, plus the demo seed, plus whatever the
-- next item adds. A history that depends on every writer remembering to append
-- is a history with holes in it — and a hole here is indistinguishable from
-- "the status did not change", which is the exact failure this table exists to
-- end. The trigger makes it structural: psql, a future migration and a caller
-- nobody has written yet are all covered.
--
-- `AFTER UPDATE OF status` still fires for same-value writes, so the function
-- checks and returns early — otherwise every unrelated unit edit that happened
-- to touch the column would log a change that did not happen.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION unit_status_history_record() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
        RETURN NEW;
    END IF;
    INSERT INTO "unit_status_history" ("id", "unitId", "facilityId", "status", "effectiveFrom")
    VALUES (gen_random_uuid()::text, NEW."id", NEW."facilityId", NEW."status", now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER unit_status_history_on_insert
    AFTER INSERT ON "unit"
    FOR EACH ROW EXECUTE FUNCTION unit_status_history_record();

CREATE TRIGGER unit_status_history_on_update
    AFTER UPDATE OF "status" ON "unit"
    FOR EACH ROW EXECUTE FUNCTION unit_status_history_record();

-- Backfill: one row per existing unit, stamped now. This is what "history
-- begins" means, and readers compare against it — a period ending before this
-- instant is one this table cannot answer, and `occupancyForFacility` says so
-- rather than substituting today's statuses under a past month's heading.
--
-- Deliberately NOT reconstructed from `audit_log`: it carries only the human
-- status changes (`unit.status_overridden`, `unit.updated`), never the derived
-- recomputes that move a unit to `occupied` on move-in — so a backfill from it
-- would be confidently partial, which reads as fact and is worse than a gap.
INSERT INTO "unit_status_history" ("id", "unitId", "facilityId", "status", "effectiveFrom")
SELECT gen_random_uuid()::text, u."id", u."facilityId", u."status", now()
FROM "unit" u;
