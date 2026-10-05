-- CreateEnum
CREATE TYPE "UnrentableReason" AS ENUM ('company_use', 'damaged', 'owner_use', 'held_for_demolition');

-- AlterTable
ALTER TABLE "unit" ADD COLUMN     "unrentableNote" TEXT,
ADD COLUMN     "unrentableReason" "UnrentableReason",
ADD COLUMN     "unrentableReviewAt" TIMESTAMPTZ(6),
ADD COLUMN     "unrentableSetAt" TIMESTAMPTZ(6),
ADD COLUMN     "unrentableSetByStaffId" TEXT;

-- CreateTable
CREATE TABLE "org_setting" (
    "id" TEXT NOT NULL DEFAULT 'org',
    "unrentableMaxUnits" INTEGER NOT NULL DEFAULT 5,
    "unrentableMaxDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "org_setting_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_unrentableSetByStaffId_fkey" FOREIGN KEY ("unrentableSetByStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
