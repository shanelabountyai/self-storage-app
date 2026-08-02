-- CreateEnum
CREATE TYPE "GateCommandType" AS ENUM ('grant_access', 'revoke_access', 'suspend_access', 'resume_access', 'set_credential');

-- CreateEnum
CREATE TYPE "GateCommandStatus" AS ENUM ('pending', 'succeeded', 'failed', 'dead_lettered');

-- CreateTable
CREATE TABLE "gate_command" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "grantId" TEXT,
    "credentialId" TEXT,
    "type" "GateCommandType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "GateCommandStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadLetteredAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_command_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gate_command_idempotencyKey_key" ON "gate_command"("idempotencyKey");

-- CreateIndex
CREATE INDEX "gate_command_status_nextAttemptAt_idx" ON "gate_command"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "gate_command_facilityId_status_idx" ON "gate_command"("facilityId", "status");

-- AddForeignKey
ALTER TABLE "gate_command" ADD CONSTRAINT "gate_command_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

