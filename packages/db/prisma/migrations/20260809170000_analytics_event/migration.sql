-- B-069 / PRD 04 FR-AN-2. The server-side event log, source of truth for the
-- funnel.
--
-- "Immune to ad blockers/consent declines." Between a fifth and a third of
-- visitors block third-party analytics, and that share correlates with the
-- channel — a client-side funnel would under-count unevenly, and an owner would
-- compare channels using numbers biased by how technical each audience is.
--
-- Nothing here identifies a person: `sessionId` is a first-party random id with
-- no account behind it.
CREATE TABLE "analytics_event" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "facilityId" TEXT,
  "sessionId"  TEXT NOT NULL,
  "channel"    TEXT,
  "utmSource"  TEXT,
  "utmMedium"  TEXT,
  "path"       TEXT,
  "properties" JSONB,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analytics_event_facilityId_occurredAt_idx" ON "analytics_event" ("facilityId", "occurredAt");
CREATE INDEX "analytics_event_name_occurredAt_idx" ON "analytics_event" ("name", "occurredAt");
CREATE INDEX "analytics_event_sessionId_idx" ON "analytics_event" ("sessionId");

ALTER TABLE "analytics_event"
  ADD CONSTRAINT "analytics_event_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
