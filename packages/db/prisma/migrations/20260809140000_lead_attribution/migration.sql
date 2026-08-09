-- B-068 / PRD 04 US-8, FR-LEAD-1, FR-LEAD-2. Web lead capture and attribution.

ALTER TABLE "lead"
  ADD COLUMN "lastTouchLandingPage" TEXT,
  -- The derived channel, stored rather than derived on read: the rules will
  -- change, and a report of last quarter must not silently re-file last
  -- quarter's leads under this quarter's rules.
  ADD COLUMN "channel"              TEXT,
  ADD COLUMN "referrer"             TEXT,
  ADD COLUMN "gclid"                TEXT,
  ADD COLUMN "landingPage"          TEXT;

CREATE INDEX "lead_channel_createdAt_idx" ON "lead" ("channel", "createdAt");

-- FR-LEAD-1: "new inquiries appended as activities rather than duplicate
-- leads." The same person asking twice in a fortnight is one lead with two
-- things to say — two leads means two staff calling them.
CREATE TABLE "lead_activity" (
  "id"        TEXT NOT NULL,
  "leadId"    TEXT NOT NULL,
  "type"      TEXT NOT NULL DEFAULT 'inquiry',
  "body"      TEXT NOT NULL,
  "channel"   TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_activity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lead_activity_leadId_createdAt_idx" ON "lead_activity" ("leadId", "createdAt");
ALTER TABLE "lead_activity"
  ADD CONSTRAINT "lead_activity_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
