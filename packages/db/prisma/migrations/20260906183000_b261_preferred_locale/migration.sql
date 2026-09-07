-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "preferredLocale" TEXT;

-- AlterTable
ALTER TABLE "message_template" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';

-- DropIndex
DROP INDEX "message_template_key_channel_facilityId_active_idx";

-- DropIndex
DROP INDEX "message_template_key_channel_facilityId_version_key";

-- CreateIndex
CREATE UNIQUE INDEX "message_template_key_channel_locale_facilityId_version_key" ON "message_template"("key", "channel", "locale", "facilityId", "version");

-- CreateIndex
CREATE INDEX "message_template_key_channel_locale_facilityId_active_idx" ON "message_template"("key", "channel", "locale", "facilityId", "active");
