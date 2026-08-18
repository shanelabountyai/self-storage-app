-- CreateEnum
CREATE TYPE "ReportCadence" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateTable
CREATE TABLE "report_subscription" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "cadence" "ReportCadence" NOT NULL,
    "recipients" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_subscription_facilityId_active_idx" ON "report_subscription"("facilityId", "active");

-- AddForeignKey
ALTER TABLE "report_subscription" ADD CONSTRAINT "report_subscription_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
