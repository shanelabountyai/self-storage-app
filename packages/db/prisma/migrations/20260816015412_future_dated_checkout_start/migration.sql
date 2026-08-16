-- AlterTable
ALTER TABLE "checkout_session" ADD COLUMN     "requestedStartDate" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "maxCheckoutStartDaysAhead" INTEGER NOT NULL DEFAULT 60;
