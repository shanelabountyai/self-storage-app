-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('email', 'sms');

-- CreateEnum
CREATE TYPE "MessageClassification" AS ENUM ('transactional', 'operational', 'marketing');

-- CreateEnum
CREATE TYPE "ChannelPolicy" AS ENUM ('email_only', 'sms_only', 'both', 'sms_preferred_email_fallback');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed', 'cancelled');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('unsubscribe', 'stop', 'hard_bounce', 'complaint', 'manual', 'kill_switch');

-- CreateTable
CREATE TABLE "message_template" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "classification" "MessageClassification" NOT NULL,
    "facilityId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT NOT NULL,
    "requiredMergeFields" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rule" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "channelPolicy" "ChannelPolicy" NOT NULL DEFAULT 'email_only',
    "classification" "MessageClassification" NOT NULL,
    "skipConditions" TEXT[],
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "facilityId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "classification" "MessageClassification" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "recipientTenantId" TEXT,
    "facilityId" TEXT,
    "toAddress" TEXT NOT NULL,
    "subjectSnapshot" TEXT,
    "bodySnapshot" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "consentId" TEXT,
    "suppressionReason" "SuppressionReason",
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "note" TEXT,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_template_key_channel_facilityId_active_idx" ON "message_template"("key", "channel", "facilityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_key_channel_facilityId_version_key" ON "message_template"("key", "channel", "facilityId", "version");

-- CreateIndex
CREATE INDEX "notification_rule_event_active_idx" ON "notification_rule"("event", "active");

-- CreateIndex
CREATE INDEX "notification_rule_facilityId_idx" ON "notification_rule"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "message_idempotencyKey_key" ON "message"("idempotencyKey");

-- CreateIndex
CREATE INDEX "message_eventId_idx" ON "message"("eventId");

-- CreateIndex
CREATE INDEX "message_recipientTenantId_createdAt_idx" ON "message"("recipientTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "message_facilityId_createdAt_idx" ON "message"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "message_status_idx" ON "message"("status");

-- CreateIndex
CREATE INDEX "suppression_address_idx" ON "suppression"("address");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_channel_address_key" ON "suppression"("channel", "address");

-- AddForeignKey
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rule" ADD CONSTRAINT "notification_rule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_recipientTenantId_fkey" FOREIGN KEY ("recipientTenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

