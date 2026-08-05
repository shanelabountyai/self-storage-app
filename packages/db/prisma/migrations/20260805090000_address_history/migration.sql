-- CreateEnum
CREATE TYPE "AddressSource" AS ENUM ('portal', 'counter', 'mail_return', 'import');

-- AlterEnum
ALTER TYPE "AuthTokenPurpose" ADD VALUE 'email_change';

-- CreateTable
CREATE TABLE "tenant_address" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "source" "AddressSource" NOT NULL,
    "actorTenantId" TEXT,
    "actorStaffId" TEXT,
    "returnedMailAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_address_tenantId_createdAt_idx" ON "tenant_address"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "tenant_address" ADD CONSTRAINT "tenant_address_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every tenant who already has an address gets the row that address
-- should always have had, so "derived from the newest row" is true from the
-- first read rather than only for tenants who happen to edit theirs later.
INSERT INTO "tenant_address" ("id", "tenantId", "addressLine1", "addressLine2", "city", "state", "postalCode", "country", "source", "createdAt")
SELECT
    gen_random_uuid()::text,
    "id",
    "addressLine1",
    "addressLine2",
    COALESCE("city", ''),
    COALESCE("state", ''),
    COALESCE("postalCode", ''),
    COALESCE("country", 'US'),
    'import',
    "createdAt"
FROM "tenant"
WHERE "addressLine1" IS NOT NULL AND "addressLine1" <> '';
