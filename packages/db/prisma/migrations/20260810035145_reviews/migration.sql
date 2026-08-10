-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('manual_google', 'manual_other', 'google_api');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "googleReviewUrl" TEXT,
ADD COLUMN     "reviewRequestDelayDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "lease" ADD COLUMN     "reviewRequestSentAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "review" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "reviewerDisplayName" TEXT NOT NULL,
    "reviewDate" DATE NOT NULL,
    "source" "ReviewSource" NOT NULL DEFAULT 'manual_google',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_facilityId_visible_reviewDate_idx" ON "review"("facilityId", "visible", "reviewDate");

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
