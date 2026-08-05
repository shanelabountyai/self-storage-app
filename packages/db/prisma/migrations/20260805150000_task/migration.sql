-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('normal', 'high');

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "assigneeStaffId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "proof" JSONB,
    "sourceEventId" TEXT,
    "completedByStaffId" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_type_entityId_businessDate_key" ON "task"("type", "entityId", "businessDate");

-- CreateIndex
CREATE INDEX "task_facilityId_status_businessDate_idx" ON "task"("facilityId", "status", "businessDate");

-- CreateIndex
CREATE INDEX "task_assigneeStaffId_status_idx" ON "task"("assigneeStaffId", "status");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assigneeStaffId_fkey" FOREIGN KEY ("assigneeStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
