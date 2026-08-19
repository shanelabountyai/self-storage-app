-- CreateEnum
CREATE TYPE "ImpersonationSubjectType" AS ENUM ('tenant', 'staff');

-- CreateEnum
CREATE TYPE "ImpersonationMode" AS ENUM ('read_only', 'read_write');

-- CreateEnum
CREATE TYPE "ImpersonationEndReason" AS ENUM ('self', 'expiry', 'forced', 'authority_changed');

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "impersonationSessionId" TEXT,
ADD COLUMN     "impersonatorStaffId" TEXT;

-- CreateTable
CREATE TABLE "impersonation_session" (
    "id" TEXT NOT NULL,
    "impersonatorStaffId" TEXT NOT NULL,
    "subjectType" "ImpersonationSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "facilityScopeSnapshot" JSONB NOT NULL,
    "mode" "ImpersonationMode" NOT NULL DEFAULT 'read_only',
    "reason" TEXT NOT NULL,
    "ticketRef" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "endedBy" "ImpersonationEndReason",
    "endedByStaffId" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "impersonation_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impersonation_session_impersonatorStaffId_startedAt_idx" ON "impersonation_session"("impersonatorStaffId", "startedAt");

-- CreateIndex
CREATE INDEX "impersonation_session_subjectType_subjectId_startedAt_idx" ON "impersonation_session"("subjectType", "subjectId", "startedAt");

-- CreateIndex
CREATE INDEX "impersonation_session_endedAt_expiresAt_idx" ON "impersonation_session"("endedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "audit_log_impersonatorStaffId_occurredAt_idx" ON "audit_log"("impersonatorStaffId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_impersonationSessionId_idx" ON "audit_log"("impersonationSessionId");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_impersonatorStaffId_fkey" FOREIGN KEY ("impersonatorStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_impersonationSessionId_fkey" FOREIGN KEY ("impersonationSessionId") REFERENCES "impersonation_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_session" ADD CONSTRAINT "impersonation_session_impersonatorStaffId_fkey" FOREIGN KEY ("impersonatorStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_session" ADD CONSTRAINT "impersonation_session_endedByStaffId_fkey" FOREIGN KEY ("endedByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
