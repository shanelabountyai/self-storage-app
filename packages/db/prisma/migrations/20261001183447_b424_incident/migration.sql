-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('break_in', 'vandalism', 'fire', 'water', 'other');

-- CreateTable
CREATE TABLE "incident" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "windowStart" TIMESTAMPTZ(6) NOT NULL,
    "windowEnd" TIMESTAMPTZ(6) NOT NULL,
    "description" TEXT NOT NULL,
    "policeReportNumber" TEXT,
    "gateLogExcerpt" JSONB NOT NULL,
    "notifiedAt" TIMESTAMPTZ(6),
    "recordedByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_unit" (
    "incidentId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "leaseId" TEXT,

    CONSTRAINT "incident_unit_pkey" PRIMARY KEY ("incidentId","unitId")
);

-- CreateIndex
CREATE INDEX "incident_facilityId_windowStart_idx" ON "incident"("facilityId", "windowStart");

-- CreateIndex
CREATE INDEX "incident_unit_unitId_idx" ON "incident_unit"("unitId");

-- CreateIndex
CREATE INDEX "incident_unit_leaseId_idx" ON "incident_unit"("leaseId");

-- AddForeignKey
ALTER TABLE "incident" ADD CONSTRAINT "incident_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident" ADD CONSTRAINT "incident_recordedByStaffId_fkey" FOREIGN KEY ("recordedByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_unit" ADD CONSTRAINT "incident_unit_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_unit" ADD CONSTRAINT "incident_unit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_unit" ADD CONSTRAINT "incident_unit_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- B-424. The gate-log excerpt is evidence, frozen at creation. Prisma cannot
-- express "this column is write-once", so the database does: an UPDATE that
-- changes it is refused, whoever sends it.
CREATE FUNCTION incident_gate_log_frozen() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'incident.gateLogExcerpt is frozen at creation and cannot be changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER incident_gate_log_frozen
  BEFORE UPDATE ON "incident"
  FOR EACH ROW
  WHEN (OLD."gateLogExcerpt" IS DISTINCT FROM NEW."gateLogExcerpt")
  EXECUTE FUNCTION incident_gate_log_frozen();
