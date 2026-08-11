-- CreateEnum
CREATE TYPE "DrawerSessionStatus" AS ENUM ('open', 'closed');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "drawerVarianceThresholdCents" INTEGER NOT NULL DEFAULT 500;

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "drawerSessionId" TEXT;

-- CreateTable
CREATE TABLE "drawer_session" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "DrawerSessionStatus" NOT NULL DEFAULT 'open',
    "openingFloatCents" INTEGER NOT NULL,
    "openedByStaffId" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedByStaffId" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "countedCashCents" INTEGER,
    "countedChecksCents" INTEGER,
    "expectedCashCents" INTEGER,
    "expectedChecksCents" INTEGER,
    "varianceCents" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "drawer_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "lowStockAt" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandise_sale" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "tenantId" TEXT,
    "soldByStaffId" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchandise_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandise_sale_line" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "merchandise_sale_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drawer_session_facilityId_businessDate_idx" ON "drawer_session"("facilityId", "businessDate");

-- CreateIndex
CREATE INDEX "drawer_session_facilityId_status_idx" ON "drawer_session"("facilityId", "status");

-- CreateIndex
CREATE INDEX "product_facilityId_active_idx" ON "product"("facilityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "product_facilityId_sku_key" ON "product"("facilityId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "merchandise_sale_paymentId_key" ON "merchandise_sale"("paymentId");

-- CreateIndex
CREATE INDEX "merchandise_sale_facilityId_occurredAt_idx" ON "merchandise_sale"("facilityId", "occurredAt");

-- CreateIndex
CREATE INDEX "merchandise_sale_line_saleId_idx" ON "merchandise_sale_line"("saleId");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_drawerSessionId_fkey" FOREIGN KEY ("drawerSessionId") REFERENCES "drawer_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawer_session" ADD CONSTRAINT "drawer_session_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_sale" ADD CONSTRAINT "merchandise_sale_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_sale" ADD CONSTRAINT "merchandise_sale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_sale" ADD CONSTRAINT "merchandise_sale_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_sale_line" ADD CONSTRAINT "merchandise_sale_line_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "merchandise_sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_sale_line" ADD CONSTRAINT "merchandise_sale_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PRD 02 US-33 (B-078). One OPEN drawer session per facility.
--
-- Prisma cannot express a partial unique index, so this is hand-written --
-- the same device `checkout_session_one_active_per_unit` uses. Several
-- CLOSED sessions per facility per day are legal on purpose (a shift-change
-- count-down opens a second one); exactly one may be open at a time, because
-- "which drawer did this cash go into" must have one answer.
CREATE UNIQUE INDEX "drawer_session_one_open_per_facility"
  ON "drawer_session" ("facilityId")
  WHERE "status" = 'open';
