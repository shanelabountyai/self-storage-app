-- AlterTable
ALTER TABLE "authorized_access_person" ADD COLUMN     "createdByTenantId" TEXT,
ADD COLUMN     "revokedByTenantId" TEXT,
ALTER COLUMN "createdByStaffId" DROP NOT NULL;
