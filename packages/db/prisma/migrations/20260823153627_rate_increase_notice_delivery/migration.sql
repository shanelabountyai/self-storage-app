-- AlterEnum
ALTER TYPE "RateIncreaseStatus" ADD VALUE 'notice_failed';

-- AlterTable
ALTER TABLE "tenant_rate_increase" ADD COLUMN     "noticeEventId" TEXT,
ADD COLUMN     "noticeFailureReason" TEXT;
