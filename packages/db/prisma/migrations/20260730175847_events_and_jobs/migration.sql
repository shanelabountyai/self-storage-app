-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('processing', 'succeeded', 'failed', 'dead_letter');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'partial');

-- CreateTable
CREATE TABLE "domain_event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_delivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'processing',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(6),
    "claimedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "event_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_run" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "facilityId" TEXT,
    "businessDate" DATE NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "itemsOk" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "lastError" TEXT,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_event_name_occurredAt_idx" ON "domain_event"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_event_facilityId_occurredAt_idx" ON "domain_event"("facilityId", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_event_entityType_entityId_idx" ON "domain_event"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "domain_event_correlationId_idx" ON "domain_event"("correlationId");

-- CreateIndex
CREATE INDEX "event_delivery_status_nextAttemptAt_idx" ON "event_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "event_delivery_consumer_status_idx" ON "event_delivery"("consumer", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_delivery_eventId_consumer_key" ON "event_delivery"("eventId", "consumer");

-- CreateIndex
CREATE INDEX "job_run_jobName_startedAt_idx" ON "job_run"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "job_run_facilityId_startedAt_idx" ON "job_run"("facilityId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_run_jobName_facilityId_businessDate_key" ON "job_run"("jobName", "facilityId", "businessDate");

-- AddForeignKey
ALTER TABLE "domain_event" ADD CONSTRAINT "domain_event_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "domain_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Outbox and scheduling invariants.
-- ---------------------------------------------------------------------------

-- A settled delivery has no pending retry, and an unsettled one has no
-- completion time. Without this a dead-lettered row could still carry a
-- nextAttemptAt and be picked up forever.
ALTER TABLE "event_delivery"
    ADD CONSTRAINT "event_delivery_settled_consistently"
    CHECK (
        ("status" IN ('succeeded', 'dead_letter') AND "completedAt" IS NOT NULL AND "nextAttemptAt" IS NULL)
        OR ("status" IN ('processing', 'failed') AND "completedAt" IS NULL)
    );

ALTER TABLE "event_delivery"
    ADD CONSTRAINT "event_delivery_attempts_non_negative"
    CHECK ("attempts" >= 0);

-- A run cannot finish before it starts, and a finished run must say when.
ALTER TABLE "job_run"
    ADD CONSTRAINT "job_run_finished_after_started"
    CHECK ("finishedAt" IS NULL OR "finishedAt" >= "startedAt");

ALTER TABLE "job_run"
    ADD CONSTRAINT "job_run_terminal_has_finished_at"
    CHECK (
        ("status" = 'running' AND "finishedAt" IS NULL)
        OR ("status" <> 'running' AND "finishedAt" IS NOT NULL)
    );

ALTER TABLE "job_run"
    ADD CONSTRAINT "job_run_counts_non_negative"
    CHECK ("itemsOk" >= 0 AND "itemsFailed" >= 0);

-- The @@unique above cannot cover the portfolio-wide case, because Postgres
-- treats NULL facilityId values as distinct — without this, a global job could
-- run twice for the same business date.
CREATE UNIQUE INDEX "job_run_one_global_per_date"
    ON "job_run" ("jobName", "businessDate")
    WHERE "facilityId" IS NULL;
