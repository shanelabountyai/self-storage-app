-- AlterTable
ALTER TABLE "delinquency_timeline" ADD COLUMN     "reversalGraceDays" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "reversalResumes" BOOLEAN NOT NULL DEFAULT true;
