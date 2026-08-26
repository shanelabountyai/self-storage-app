-- AlterTable
ALTER TABLE "payment_plan" ADD COLUMN     "invoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
