-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('payment_reminders', 'receipts', 'operational_notices');

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'deferred';

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "smsMessagingServiceSid" TEXT,
ADD COLUMN     "smsQuietHoursEndHour" INTEGER NOT NULL DEFAULT 21,
ADD COLUMN     "smsQuietHoursStartHour" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "notification_rule" ADD COLUMN     "category" "NotificationCategory";

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_tenantId_category_channel_key" ON "notification_preference"("tenantId", "category", "channel");

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
