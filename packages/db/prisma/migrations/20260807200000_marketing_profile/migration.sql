-- B-067 / PRD 04 US-2, US-5. The facility marketing profile.

-- The unique content blocks a marketer edits without a deploy. All nullable:
-- every one falls back to B-066's generated default, so a facility nobody has
-- written copy for still has a title, a description and five true FAQs.
ALTER TABLE "facility"
  ADD COLUMN "seoTitle"        TEXT,
  ADD COLUMN "metaDescription" TEXT,
  ADD COLUMN "heroCopy"        TEXT,
  ADD COLUMN "longDescription" TEXT,
  -- US-5 AC2: staff-confirmed GBP checklist, flagged when older than 90 days.
  ADD COLUMN "gbpVerifiedAt"   TIMESTAMPTZ(6),
  ADD COLUMN "gbpCheckedItems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "facility_faq" (
  "id"         TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "question"   TEXT NOT NULL,
  "answer"     TEXT NOT NULL,
  "position"   INTEGER NOT NULL,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "facility_faq_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "facility_faq_facilityId_position_idx" ON "facility_faq" ("facilityId", "position");
ALTER TABLE "facility_faq"
  ADD CONSTRAINT "facility_faq_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "FacilityPhotoKind" AS ENUM ('exterior', 'gate', 'hallway', 'unit', 'security', 'other');

-- `alt` is NOT NULL rather than nullable-with-a-lint-rule. WCAG 1.1.1 is an
-- acceptance criterion here, and a photo set where three of eleven have alt
-- text is the normal outcome of making it optional.
CREATE TABLE "facility_photo" (
  "id"         TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "alt"        TEXT NOT NULL,
  "kind"       "FacilityPhotoKind" NOT NULL DEFAULT 'other',
  "position"   INTEGER NOT NULL,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "facility_photo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "facility_photo_facilityId_position_idx" ON "facility_photo" ("facilityId", "position");
ALTER TABLE "facility_photo"
  ADD CONSTRAINT "facility_photo_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
