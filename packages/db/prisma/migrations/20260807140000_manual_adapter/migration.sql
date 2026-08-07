-- B-065 / PRD 03 US-6. The manual fallback.

-- Handed to a human. Not `pending` (the retry loop would make one task per
-- attempt) and not `dead_lettered` (nothing has gone wrong).
ALTER TYPE "GateCommandStatus" ADD VALUE 'awaiting_manual';

-- FR-3's per-facility adapter selection, and US-6 AC2's configurable SLA.
ALTER TABLE "facility" ADD COLUMN "gateAdapter" TEXT NOT NULL DEFAULT 'simulated';
ALTER TABLE "facility" ADD COLUMN "manualTaskSlaHours" INTEGER NOT NULL DEFAULT 4;
