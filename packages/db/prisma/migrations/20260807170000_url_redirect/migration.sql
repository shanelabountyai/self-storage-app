-- B-066 / PRD 04 FR-SEO-2. The 301 map for renamed and retired slugs.
--
-- A slug that has ever been public has been linked to and indexed. Changing it
-- without a redirect throws away every link pointing at the old one and hands a
-- renter a 404 — invisible until the traffic has already gone.
CREATE TABLE "url_redirect" (
  "id"        TEXT NOT NULL,
  "fromPath"  TEXT NOT NULL,
  "toPath"    TEXT NOT NULL,
  "permanent" BOOLEAN NOT NULL DEFAULT true,
  "reason"    TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "url_redirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "url_redirect_fromPath_key" ON "url_redirect" ("fromPath");
CREATE INDEX "url_redirect_fromPath_idx" ON "url_redirect" ("fromPath");
