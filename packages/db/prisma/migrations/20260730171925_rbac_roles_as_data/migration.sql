-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rank" INTEGER NOT NULL,
    "isStaffRole" BOOLEAN NOT NULL DEFAULT true,
    "maxFeeWaiverCents" INTEGER,
    "maxRefundCents" INTEGER,
    "maxCreditCents" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "roleId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "staff_facility_assignment" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "facilityId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_facility_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_key_key" ON "role"("key");

-- CreateIndex
CREATE INDEX "role_rank_idx" ON "role"("rank");

-- CreateIndex
CREATE INDEX "role_permission_permissionKey_idx" ON "role_permission"("permissionKey");

-- CreateIndex
CREATE INDEX "staff_facility_assignment_facilityId_idx" ON "staff_facility_assignment"("facilityId");

-- CreateIndex
CREATE INDEX "staff_facility_assignment_staffUserId_idx" ON "staff_facility_assignment"("staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_facility_assignment_staffUserId_facilityId_key" ON "staff_facility_assignment"("staffUserId", "facilityId");

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_facility_assignment" ADD CONSTRAINT "staff_facility_assignment_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_facility_assignment" ADD CONSTRAINT "staff_facility_assignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_facility_assignment" ADD CONSTRAINT "staff_facility_assignment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RBAC invariants the schema language cannot express.
-- ---------------------------------------------------------------------------

-- "A user has exactly one role per facility assignment" (PRD 02 §3). The
-- @@unique([staffUserId, facilityId]) above cannot enforce this for the
-- all-facilities row, because Postgres treats NULLs as distinct — without this
-- a user could hold two conflicting org-wide roles at once.
CREATE UNIQUE INDEX "staff_assignment_one_all_facilities_per_user"
    ON "staff_facility_assignment" ("staffUserId")
    WHERE "facilityId" IS NULL;

-- Monetary authority is a limit, not a debt: null means unlimited, 0 means no
-- authority, and negative is never meaningful (PRD 02 RBAC-2).
ALTER TABLE "role"
    ADD CONSTRAINT "role_monetary_limits_non_negative"
    CHECK (
        ("maxFeeWaiverCents" IS NULL OR "maxFeeWaiverCents" >= 0)
        AND ("maxRefundCents" IS NULL OR "maxRefundCents" >= 0)
        AND ("maxCreditCents" IS NULL OR "maxCreditCents" >= 0)
    );
