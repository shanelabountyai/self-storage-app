-- CreateEnum
CREATE TYPE "AuctionSaleManner" AS ENUM ('online', 'live_onsite');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "auctionSaleManner" "AuctionSaleManner" NOT NULL DEFAULT 'online',
ADD COLUMN     "auctionSaleVenue" TEXT;
