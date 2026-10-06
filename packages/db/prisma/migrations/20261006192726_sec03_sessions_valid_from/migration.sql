-- AlterTable
ALTER TABLE "staff_user" ADD COLUMN     "sessionsValidFrom" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "sessionsValidFrom" TIMESTAMPTZ(6);
