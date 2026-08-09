-- B-070 / PRD 04 §3.6 FR-PROMO-1..5, PRD 02 US-10. The promotions engine.

ALTER TABLE "promotion" ADD COLUMN "minStayMonths" INTEGER NOT NULL DEFAULT 0;

-- FR-PROMO-2. One promo can have many codes — a print run, a partner, an
-- influencer — each with its own expiry and cap. `code` is stored lower-case
-- so the unique index enforces "unique, case-insensitive" rather than a
-- case-insensitive lookup the index cannot help with.
CREATE TABLE "promo_code" (
  "id"          TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "expiresAt"   TIMESTAMPTZ(6),
  "maxUses"     INTEGER,
  "usesCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promo_code_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_code_code_key" ON "promo_code" ("code");
CREATE INDEX "promo_code_promotionId_idx" ON "promo_code" ("promotionId");
ALTER TABLE "promo_code"
  ADD CONSTRAINT "promo_code_promotionId_fkey"
  FOREIGN KEY ("promotionId") REFERENCES "promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FR-PROMO-4. The snapshot is the point: a percentage of a rent that later
-- changes would silently change what was promised. Billing reads this row,
-- never the promotion it came from.
CREATE TABLE "promo_redemption" (
  "id"             TEXT NOT NULL,
  "promotionId"    TEXT NOT NULL,
  "promoCodeId"    TEXT,
  "facilityId"     TEXT NOT NULL,
  "reservationId"  TEXT,
  "leaseId"        TEXT,
  "schedule"       JSONB NOT NULL,
  "totalCents"     INTEGER NOT NULL,
  -- Append-only. Billing adds an index when it writes the discount line, so a
  -- re-run of the nightly job cannot discount the same period twice.
  "appliedPeriods" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promo_redemption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_redemption_leaseId_key" ON "promo_redemption" ("leaseId");
CREATE INDEX "promo_redemption_promotionId_createdAt_idx" ON "promo_redemption" ("promotionId", "createdAt");
CREATE INDEX "promo_redemption_facilityId_createdAt_idx" ON "promo_redemption" ("facilityId", "createdAt");

ALTER TABLE "promo_redemption"
  ADD CONSTRAINT "promo_redemption_promotionId_fkey"
  FOREIGN KEY ("promotionId") REFERENCES "promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "promo_redemption_promoCodeId_fkey"
  FOREIGN KEY ("promoCodeId") REFERENCES "promo_code"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "promo_redemption_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "promo_redemption_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "promo_redemption_leaseId_fkey"
  FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
