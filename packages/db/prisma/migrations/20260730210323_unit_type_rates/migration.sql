-- Street/web rates move from flat columns on unit_type to an effective-dated
-- table (PRD 02 US-9, FR-9).
--
-- Statement order matters and is NOT what Prisma generated. Prisma emitted the
-- DROP COLUMN first, which would have discarded every existing rate before the
-- backfill could read it. Create → backfill → drop.

-- CreateTable
CREATE TABLE "unit_type_rate" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitTypeId" TEXT NOT NULL,
    "streetRateCents" INTEGER NOT NULL,
    "webRateCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_type_rate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_type_rate_facilityId_effectiveFrom_idx" ON "unit_type_rate"("facilityId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "unit_type_rate_unitTypeId_effectiveFrom_idx" ON "unit_type_rate"("unitTypeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "unit_type_rate_unitTypeId_effectiveFrom_key" ON "unit_type_rate"("unitTypeId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "unit_type_rate" ADD CONSTRAINT "unit_type_rate_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_type_rate" ADD CONSTRAINT "unit_type_rate_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: every existing unit type keeps its current rate as its first
-- effective-dated row, dated from when the type was created so it has always
-- been in effect. Without this, the DROP below silently zeroes out pricing.
-- ---------------------------------------------------------------------------
INSERT INTO "unit_type_rate" ("id", "facilityId", "unitTypeId", "streetRateCents", "webRateCents", "effectiveFrom", "createdAt")
SELECT
    -- gen_random_uuid() is built in from Postgres 13; cuid() is app-side only.
    gen_random_uuid()::text,
    "facilityId",
    "id",
    "streetRateCents",
    "webRateCents",
    "createdAt",
    now()
FROM "unit_type";

-- AlterTable — safe only now that the values above are preserved.
ALTER TABLE "unit_type" DROP COLUMN "streetRateCents",
DROP COLUMN "webRateCents";

-- Rates are money in cents and never negative. Zero is legitimate (a free
-- promotional type), so the floor is zero rather than one.
ALTER TABLE "unit_type_rate"
    ADD CONSTRAINT "unit_type_rate_amounts_non_negative"
    CHECK ("streetRateCents" >= 0 AND "webRateCents" >= 0);
