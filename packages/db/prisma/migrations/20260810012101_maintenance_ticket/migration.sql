-- CreateEnum
CREATE TYPE "MaintenanceTicketStatus" AS ENUM ('open', 'in_progress', 'blocked', 'done');

-- CreateTable
CREATE TABLE "maintenance_ticket" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "MaintenanceTicketStatus" NOT NULL DEFAULT 'open',
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "blocksAvailability" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "createdByStaffId" TEXT,
    "assigneeStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "maintenance_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_ticket_facilityId_status_idx" ON "maintenance_ticket"("facilityId", "status");

-- CreateIndex
CREATE INDEX "maintenance_ticket_unitId_status_idx" ON "maintenance_ticket"("unitId", "status");

-- AddForeignKey
ALTER TABLE "maintenance_ticket" ADD CONSTRAINT "maintenance_ticket_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_ticket" ADD CONSTRAINT "maintenance_ticket_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
