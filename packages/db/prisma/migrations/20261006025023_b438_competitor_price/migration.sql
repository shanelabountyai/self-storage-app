-- CreateTable
CREATE TABLE "competitor_price" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitTypeId" TEXT NOT NULL,
    "competitorName" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "observedOn" DATE NOT NULL,
    "enteredByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_price_facilityId_unitTypeId_observedOn_idx" ON "competitor_price"("facilityId", "unitTypeId", "observedOn");

-- AddForeignKey
ALTER TABLE "competitor_price" ADD CONSTRAINT "competitor_price_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_price" ADD CONSTRAINT "competitor_price_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_price" ADD CONSTRAINT "competitor_price_enteredByStaffId_fkey" FOREIGN KEY ("enteredByStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
