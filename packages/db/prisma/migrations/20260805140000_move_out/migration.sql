-- CreateEnum
CREATE TYPE "MoveOutReason" AS ENUM ('tenant_request', 'abandonment');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "prorateOnMoveOut" BOOLEAN NOT NULL DEFAULT false,
                       ADD COLUMN     "moveOutNoticeDays" INTEGER NOT NULL DEFAULT 10,
                       ADD COLUMN     "writeOffThresholdCents" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "lease" ADD COLUMN     "noticeGivenAt" TIMESTAMPTZ(6),
                    ADD COLUMN     "paidThroughDate" DATE,
                    ADD COLUMN     "moveOutDate" DATE,
                    ADD COLUMN     "moveOutReason" "MoveOutReason";
