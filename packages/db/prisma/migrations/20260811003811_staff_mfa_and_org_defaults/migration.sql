-- CreateEnum
CREATE TYPE "OrgDefaultScope" AS ENUM ('fee_schedule', 'late_fee_ladder', 'delinquency_timeline');

-- AlterTable
ALTER TABLE "staff_user" ADD COLUMN     "totpConfirmedAt" TIMESTAMPTZ(6),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "staff_recovery_code" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_default" (
    "id" TEXT NOT NULL,
    "scope" "OrgDefaultScope" NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "org_default_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_recovery_code_codeHash_key" ON "staff_recovery_code"("codeHash");

-- CreateIndex
CREATE INDEX "staff_recovery_code_staffUserId_usedAt_idx" ON "staff_recovery_code"("staffUserId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "org_default_scope_key" ON "org_default"("scope");

-- AddForeignKey
ALTER TABLE "staff_recovery_code" ADD CONSTRAINT "staff_recovery_code_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_default" ADD CONSTRAINT "org_default_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
