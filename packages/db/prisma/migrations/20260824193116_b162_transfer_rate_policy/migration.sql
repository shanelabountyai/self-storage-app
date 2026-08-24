-- CreateEnum
CREATE TYPE "TransferRatePolicy" AS ENUM ('preserve_discount', 'street', 'in_place');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "transferRatePolicy" "TransferRatePolicy" NOT NULL DEFAULT 'preserve_discount';
