-- AlterTable
ALTER TABLE "access_credential" ADD COLUMN     "codeHash" TEXT;

-- AlterTable
ALTER TABLE "access_grant" ADD COLUMN     "authorizedPersonId" TEXT,
ALTER COLUMN "tenantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "authorizedAccessCap" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "authorized_access_person" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "accessHours" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByStaffId" TEXT NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedByStaffId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "authorized_access_person_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "authorized_access_person_facilityId_leaseId_idx" ON "authorized_access_person"("facilityId", "leaseId");

-- CreateIndex
CREATE INDEX "access_credential_facilityId_codeHash_idx" ON "access_credential"("facilityId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "access_grant_authorizedPersonId_key" ON "access_grant"("authorizedPersonId");

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_authorizedPersonId_fkey" FOREIGN KEY ("authorizedPersonId") REFERENCES "authorized_access_person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_access_person" ADD CONSTRAINT "authorized_access_person_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_access_person" ADD CONSTRAINT "authorized_access_person_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- B-029 / PRD 03 FR-1. Exactly one credential holder per grant: the tenant, or
-- an authorized person, never both and never neither. Prisma's schema
-- language cannot express this, so it is a raw CHECK — the database is the
-- backstop; ensureGrantForHolder() enforces the same rule at write time.
ALTER TABLE "access_grant"
    ADD CONSTRAINT "access_grant_exactly_one_holder"
    CHECK (
        ("tenantId" IS NOT NULL AND "authorizedPersonId" IS NULL)
        OR ("tenantId" IS NULL AND "authorizedPersonId" IS NOT NULL)
    );
