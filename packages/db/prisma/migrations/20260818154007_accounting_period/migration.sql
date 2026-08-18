-- CreateTable
CREATE TABLE "accounting_period" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "closedAt" TIMESTAMPTZ(6),
    "closedByStaffId" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounting_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_period_facilityId_year_month_key" ON "accounting_period"("facilityId", "year", "month");

-- AddForeignKey
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_closedByStaffId_fkey" FOREIGN KEY ("closedByStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
