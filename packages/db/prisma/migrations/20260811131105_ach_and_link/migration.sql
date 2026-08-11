-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'processing';

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "achAtCheckoutEnabled" BOOLEAN NOT NULL DEFAULT false;
