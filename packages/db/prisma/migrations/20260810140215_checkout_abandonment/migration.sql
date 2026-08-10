-- AlterTable
ALTER TABLE "checkout_session" ADD COLUMN     "abandonmentSequenceStep" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "abandonmentFollowUpHours" INTEGER[] DEFAULT ARRAY[1, 24, 72]::INTEGER[];
