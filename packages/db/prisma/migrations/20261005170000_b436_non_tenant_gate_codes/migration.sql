-- CreateEnum
CREATE TYPE "AccessHolderType" AS ENUM ('staff', 'vendor', 'temporary');

-- AlterTable
ALTER TABLE "access_grant" ADD COLUMN     "accessHours" JSONB,
ADD COLUMN     "auctionCaseId" TEXT,
ADD COLUMN     "createdByStaffId" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "holderName" TEXT,
ADD COLUMN     "holderType" "AccessHolderType",
ADD COLUMN     "staffUserId" TEXT;

-- CreateIndex
CREATE INDEX "access_grant_staffUserId_idx" ON "access_grant"("staffUserId");

-- CreateIndex
CREATE INDEX "access_grant_auctionCaseId_idx" ON "access_grant"("auctionCaseId");

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_auctionCaseId_fkey" FOREIGN KEY ("auctionCaseId") REFERENCES "auction_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- B-436 / PRD 03 US-10. A grant now has one of THREE kinds of holder: the
-- tenant, an authorized person, or a named non-tenant (staff, vendor,
-- temporary). Still exactly one, never two and never none, and a non-tenant
-- holder must carry the name the gate log shows.
ALTER TABLE "access_grant" DROP CONSTRAINT "access_grant_exactly_one_holder";
ALTER TABLE "access_grant"
    ADD CONSTRAINT "access_grant_exactly_one_holder"
    CHECK (
        (("tenantId" IS NOT NULL)::int
         + ("authorizedPersonId" IS NOT NULL)::int
         + ("holderType" IS NOT NULL)::int) = 1
        AND ("holderType" IS NULL OR "holderName" IS NOT NULL)
    );
