-- CreateEnum
CREATE TYPE "NoticeDeliveryMethod" AS ENUM ('certified_mail', 'first_class_mail', 'hand_delivered', 'posted_on_unit', 'email');

-- AlterTable
ALTER TABLE "notice" ADD COLUMN     "claimSnapshot" JSONB,
ADD COLUMN     "claimTotalCents" INTEGER,
ADD COLUMN     "correctsNoticeId" TEXT,
ADD COLUMN     "deadlineDate" DATE,
ADD COLUMN     "deliveredAt" TIMESTAMPTZ(6),
ADD COLUMN     "deliveryMethod" "NoticeDeliveryMethod",
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "generatedByStaffId" TEXT,
ADD COLUMN     "noticeTemplateId" TEXT,
ADD COLUMN     "renderedAddressLine1" TEXT,
ADD COLUMN     "renderedAddressLine2" TEXT,
ADD COLUMN     "renderedCity" TEXT,
ADD COLUMN     "renderedPostalCode" TEXT,
ADD COLUMN     "renderedState" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMPTZ(6),
ADD COLUMN     "templateVersion" INTEGER,
ADD COLUMN     "tenantAddressId" TEXT;

-- CreateTable
CREATE TABLE "notice_template" (
    "id" TEXT NOT NULL,
    "type" "NoticeType" NOT NULL,
    "facilityId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notice_template_type_facilityId_active_idx" ON "notice_template"("type", "facilityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "notice_template_type_facilityId_version_key" ON "notice_template"("type", "facilityId", "version");

-- CreateIndex
CREATE INDEX "notice_leaseId_type_supersededAt_idx" ON "notice"("leaseId", "type", "supersededAt");

-- AddForeignKey
ALTER TABLE "notice_template" ADD CONSTRAINT "notice_template_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice" ADD CONSTRAINT "notice_noticeTemplateId_fkey" FOREIGN KEY ("noticeTemplateId") REFERENCES "notice_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice" ADD CONSTRAINT "notice_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice" ADD CONSTRAINT "notice_correctsNoticeId_fkey" FOREIGN KEY ("correctsNoticeId") REFERENCES "notice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
