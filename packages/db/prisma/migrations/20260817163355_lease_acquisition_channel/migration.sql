-- AlterTable
ALTER TABLE "lease" ADD COLUMN     "acquisitionChannel" TEXT,
ADD COLUMN     "acquisitionUtmCampaign" TEXT,
ADD COLUMN     "acquisitionUtmMedium" TEXT,
ADD COLUMN     "acquisitionUtmSource" TEXT;

-- CreateIndex
CREATE INDEX "lease_facilityId_startDate_acquisitionChannel_idx" ON "lease"("facilityId", "startDate", "acquisitionChannel");
