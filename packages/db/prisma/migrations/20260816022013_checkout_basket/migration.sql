-- CreateTable
CREATE TABLE "checkout_session_unit" (
    "id" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "unitTypeId" TEXT NOT NULL,
    "unitId" TEXT,
    "quotedRateCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_session_unit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkout_session_unit_checkoutSessionId_idx" ON "checkout_session_unit"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "checkout_session_unit_unitId_idx" ON "checkout_session_unit"("unitId");

-- AddForeignKey
ALTER TABLE "checkout_session_unit" ADD CONSTRAINT "checkout_session_unit_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session_unit" ADD CONSTRAINT "checkout_session_unit_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session_unit" ADD CONSTRAINT "checkout_session_unit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- B-106. Backfill: one basket line per existing session, from the columns it
-- already carries.
--
-- Written into the migration BEFORE it is applied (CLAUDE.md: appending SQL to
-- an already-applied migration desyncs its checksum and the next `migrate dev`
-- offers to reset the development database).
--
-- Every session gets a line, not just live ones. A completed session is the
-- historical record of what somebody rented, and code that reads the basket
-- must find the same answer there as the old columns gave — otherwise a
-- confirmation page or a report looking at last month's checkout would show an
-- empty basket.
--
-- `gen_random_uuid()` rather than a cuid: this runs in SQL, the id is never
-- shown, and pgcrypto is already available in Postgres 17 core.
INSERT INTO "checkout_session_unit" ("id", "checkoutSessionId", "unitTypeId", "unitId", "quotedRateCents", "createdAt")
SELECT gen_random_uuid()::text, "id", "unitTypeId", "unitId", "quotedRateCents", "createdAt"
FROM "checkout_session";
