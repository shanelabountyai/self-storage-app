-- B-064 / PRD 03 US-4, US-5, FR-4, FR-5.

-- US-4 AC3: 24-hour access as a per-grant add-on.
ALTER TABLE "access_grant" ADD COLUMN "extendedHours" BOOLEAN NOT NULL DEFAULT false;

-- US-5 AC3: anomaly flags, computed at ingestion and stored, because the flag
-- is evidence of what the system thought at the time.
ALTER TABLE "access_event" ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "access_event_credentialId_occurredAt_idx"
  ON "access_event" ("credentialId", "occurredAt");

-- US-4 AC2: the vendor's own copy of the time window. On the simulated
-- controller's row rather than read from `facility` at keypad time, so that
-- "edited but never propagated" is reproducible rather than impossible.
ALTER TABLE "simulated_gate_code" ADD COLUMN "windowSchedule" JSONB;
ALTER TABLE "simulated_gate_code" ADD COLUMN "windowExempt" BOOLEAN NOT NULL DEFAULT false;

-- US-4 AC1: propagation to active grants.
ALTER TYPE "GateCommandType" ADD VALUE 'set_time_window';
