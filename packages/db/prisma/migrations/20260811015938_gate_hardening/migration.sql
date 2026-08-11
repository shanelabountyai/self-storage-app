-- CreateTable
CREATE TABLE "gate_reconciliation_run" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "adapter" TEXT NOT NULL,
    "verifiable" BOOLEAN NOT NULL DEFAULT true,
    "credentialsChecked" INTEGER NOT NULL DEFAULT 0,
    "driftCount" INTEGER NOT NULL DEFAULT 0,
    "permissiveCount" INTEGER NOT NULL DEFAULT 0,
    "drifts" JSONB NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "gate_reconciliation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_webhook_secret" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "retiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByStaffId" TEXT,

    CONSTRAINT "gate_webhook_secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_camera" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "facility_camera_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_reconciliation_run_facilityId_startedAt_idx" ON "gate_reconciliation_run"("facilityId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "gate_reconciliation_run_facilityId_businessDate_key" ON "gate_reconciliation_run"("facilityId", "businessDate");

-- CreateIndex
CREATE INDEX "gate_webhook_secret_facilityId_active_idx" ON "gate_webhook_secret"("facilityId", "active");

-- CreateIndex
CREATE INDEX "facility_camera_facilityId_sortOrder_idx" ON "facility_camera"("facilityId", "sortOrder");

-- AddForeignKey
ALTER TABLE "gate_reconciliation_run" ADD CONSTRAINT "gate_reconciliation_run_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_webhook_secret" ADD CONSTRAINT "gate_webhook_secret_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_camera" ADD CONSTRAINT "facility_camera_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PRD 03 SR-4 (B-080). Exactly one ACTIVE webhook secret per facility.
--
-- Prisma cannot express a partial unique index, so this is hand-written — the
-- same device `checkout_session_one_active_per_unit` and
-- `drawer_session_one_open_per_facility` use. Several RETIRING secrets per
-- facility are legal and expected: that is the dual-secret window rotation
-- needs, and a site rotated twice in an afternoon legitimately has two of them
-- still being accepted. Exactly one may be active, because "which secret do we
-- sign with" must have one answer.
CREATE UNIQUE INDEX "gate_webhook_secret_one_active_per_facility"
  ON "gate_webhook_secret" ("facilityId")
  WHERE "active" = true;
