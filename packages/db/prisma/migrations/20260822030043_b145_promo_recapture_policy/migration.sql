-- CreateEnum
CREATE TYPE "PromoRecapturePolicy" AS ENUM ('none', 'full', 'prorated');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "promoRecapturePolicy" "PromoRecapturePolicy" NOT NULL DEFAULT 'none';
