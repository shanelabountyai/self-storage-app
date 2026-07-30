-- CreateEnum
CREATE TYPE "FacilityStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('available', 'reserved', 'occupied', 'overlocked', 'maintenance', 'unrentable');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('pending', 'active', 'delinquent', 'pending_auction', 'ended');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'open', 'partially_paid', 'paid', 'void', 'uncollectible');

-- CreateEnum
CREATE TYPE "LineItemType" AS ENUM ('rent', 'fee', 'protection', 'tax', 'discount');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'ach', 'cash', 'check', 'money_order');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('charge', 'payment', 'credit', 'refund', 'adjustment', 'write_off');

-- CreateEnum
CREATE TYPE "AccessGrantState" AS ENUM ('pending', 'active', 'suspended', 'revoked');

-- CreateEnum
CREATE TYPE "AccessCredentialType" AS ENUM ('pin', 'mobile_key');

-- CreateEnum
CREATE TYPE "AccessCredentialState" AS ENUM ('active', 'suspended', 'revoked');

-- CreateEnum
CREATE TYPE "HardwareSyncStatus" AS ENUM ('pending', 'synced', 'failed');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('held', 'converted', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'reserved', 'converted', 'lost');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('percent_off', 'amount_off', 'free_months');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('draft', 'active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "PromotionDisplayMode" AS ENUM ('auto', 'code');

-- CreateEnum
CREATE TYPE "NoticeType" AS ENUM ('late_notice', 'pre_lien', 'lien', 'auction', 'rate_change', 'move_out');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('draft', 'generated', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('marketing_email', 'marketing_sms', 'account_email', 'account_sms');

-- CreateEnum
CREATE TYPE "ConsentState" AS ENUM ('granted', 'revoked');

-- CreateEnum
CREATE TYPE "StaffUserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('staff', 'tenant', 'system');

-- CreateTable
CREATE TABLE "facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "FacilityStatus" NOT NULL DEFAULT 'active',
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "officeHours" JSONB,
    "gateHours" JSONB,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_type" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthFt" INTEGER NOT NULL,
    "lengthFt" INTEGER NOT NULL,
    "heightFt" INTEGER,
    "climateControlled" BOOLEAN NOT NULL DEFAULT false,
    "driveUp" BOOLEAN NOT NULL DEFAULT false,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "powerAvailable" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "streetRateCents" INTEGER NOT NULL,
    "webRateCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "unit_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitTypeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "doorType" TEXT,
    "status" "UnitStatus" NOT NULL DEFAULT 'available',
    "mapX" DOUBLE PRECISION,
    "mapY" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'US',
    "altContactName" TEXT,
    "altContactPhone" TEXT,
    "altContactEmail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" "LeaseStatus" NOT NULL DEFAULT 'pending',
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6),
    "monthlyRateCents" INTEGER NOT NULL,
    "billingDay" INTEGER NOT NULL,
    "protectionPlanName" TEXT,
    "protectionCents" INTEGER NOT NULL DEFAULT 0,
    "protectionWaivedAt" TIMESTAMPTZ(6),
    "signedDocumentUrl" TEXT,
    "signedDocumentHash" TEXT,
    "signedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "issueDate" TIMESTAMPTZ(6) NOT NULL,
    "dueDate" TIMESTAMPTZ(6) NOT NULL,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_item" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" "LineItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "stripePaymentIntentId" TEXT,
    "tenderedCents" INTEGER,
    "changeCents" INTEGER,
    "checkNumber" TEXT,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureReason" TEXT,
    "refundOfPaymentId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_grant" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "state" "AccessGrantState" NOT NULL DEFAULT 'pending',
    "stateCause" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "access_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_credential" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "leaseId" TEXT,
    "type" "AccessCredentialType" NOT NULL DEFAULT 'pin',
    "valueRef" TEXT NOT NULL,
    "state" "AccessCredentialState" NOT NULL DEFAULT 'active',
    "syncStatus" "HardwareSyncStatus" NOT NULL DEFAULT 'pending',
    "lastSyncAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "access_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "unitTypeId" TEXT NOT NULL,
    "unitId" TEXT,
    "tenantId" TEXT,
    "leadId" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'held',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "quotedRateCents" INTEGER NOT NULL,
    "moveInDate" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "unitTypeId" TEXT,
    "tenantId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "source" TEXT,
    "firstTouchSource" TEXT,
    "firstTouchMedium" TEXT,
    "firstTouchCampaign" TEXT,
    "firstTouchLandingPage" TEXT,
    "lastTouchSource" TEXT,
    "lastTouchMedium" TEXT,
    "lastTouchCampaign" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "value" INTEGER NOT NULL,
    "durationPeriods" INTEGER NOT NULL DEFAULT 1,
    "status" "PromotionStatus" NOT NULL DEFAULT 'draft',
    "displayMode" "PromotionDisplayMode" NOT NULL DEFAULT 'auto',
    "facilityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "newTenantOnly" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMPTZ(6),
    "endsAt" TIMESTAMPTZ(6),
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "termsText" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "leadId" TEXT,
    "channel" "ConsentChannel" NOT NULL,
    "state" "ConsentState" NOT NULL,
    "source" TEXT NOT NULL,
    "disclosureVersion" TEXT,
    "ipAddress" TEXT,
    "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "type" "NoticeType" NOT NULL,
    "status" "NoticeStatus" NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMPTZ(6),
    "documentUrl" TEXT,
    "documentHash" TEXT,
    "deliveryProof" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "StaffUserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "staff_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorStaffId" TEXT,
    "actorLabel" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reasonCode" TEXT,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facility_slug_key" ON "facility"("slug");

-- CreateIndex
CREATE INDEX "facility_state_idx" ON "facility"("state");

-- CreateIndex
CREATE INDEX "unit_type_facilityId_idx" ON "unit_type"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_type_facilityId_name_key" ON "unit_type"("facilityId", "name");

-- CreateIndex
CREATE INDEX "unit_facilityId_status_idx" ON "unit"("facilityId", "status");

-- CreateIndex
CREATE INDEX "unit_unitTypeId_idx" ON "unit"("unitTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_facilityId_number_key" ON "unit"("facilityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_email_key" ON "tenant"("email");

-- CreateIndex
CREATE INDEX "tenant_lastName_firstName_idx" ON "tenant"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "lease_facilityId_status_idx" ON "lease"("facilityId", "status");

-- CreateIndex
CREATE INDEX "lease_tenantId_idx" ON "lease"("tenantId");

-- CreateIndex
CREATE INDEX "lease_unitId_idx" ON "lease"("unitId");

-- CreateIndex
CREATE INDEX "invoice_leaseId_dueDate_idx" ON "invoice"("leaseId", "dueDate");

-- CreateIndex
CREATE INDEX "invoice_facilityId_status_idx" ON "invoice"("facilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_facilityId_number_key" ON "invoice"("facilityId", "number");

-- CreateIndex
CREATE INDEX "invoice_line_item_invoiceId_idx" ON "invoice_line_item"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_stripePaymentIntentId_key" ON "payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "payment_facilityId_receivedAt_idx" ON "payment"("facilityId", "receivedAt");

-- CreateIndex
CREATE INDEX "payment_tenantId_idx" ON "payment"("tenantId");

-- CreateIndex
CREATE INDEX "payment_allocation_invoiceId_idx" ON "payment_allocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocation_paymentId_invoiceId_key" ON "payment_allocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_reversalOfId_key" ON "ledger_entry"("reversalOfId");

-- CreateIndex
CREATE INDEX "ledger_entry_leaseId_occurredAt_idx" ON "ledger_entry"("leaseId", "occurredAt");

-- CreateIndex
CREATE INDEX "ledger_entry_facilityId_occurredAt_idx" ON "ledger_entry"("facilityId", "occurredAt");

-- CreateIndex
CREATE INDEX "access_grant_facilityId_state_idx" ON "access_grant"("facilityId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "access_grant_facilityId_tenantId_key" ON "access_grant"("facilityId", "tenantId");

-- CreateIndex
CREATE INDEX "access_credential_facilityId_state_idx" ON "access_credential"("facilityId", "state");

-- CreateIndex
CREATE INDEX "access_credential_grantId_idx" ON "access_credential"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_tokenHash_key" ON "reservation"("tokenHash");

-- CreateIndex
CREATE INDEX "reservation_facilityId_status_idx" ON "reservation"("facilityId", "status");

-- CreateIndex
CREATE INDEX "reservation_status_expiresAt_idx" ON "reservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "lead_facilityId_status_idx" ON "lead"("facilityId", "status");

-- CreateIndex
CREATE INDEX "lead_email_idx" ON "lead"("email");

-- CreateIndex
CREATE INDEX "lead_phone_idx" ON "lead"("phone");

-- CreateIndex
CREATE INDEX "promotion_status_idx" ON "promotion"("status");

-- CreateIndex
CREATE INDEX "consent_tenantId_channel_idx" ON "consent"("tenantId", "channel");

-- CreateIndex
CREATE INDEX "consent_leadId_channel_idx" ON "consent"("leadId", "channel");

-- CreateIndex
CREATE INDEX "notice_facilityId_type_idx" ON "notice"("facilityId", "type");

-- CreateIndex
CREATE INDEX "notice_leaseId_idx" ON "notice"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_email_key" ON "staff_user"("email");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_facilityId_occurredAt_idx" ON "audit_log"("facilityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_correlationId_idx" ON "audit_log"("correlationId");

-- AddForeignKey
ALTER TABLE "unit_type" ADD CONSTRAINT "unit_type_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease" ADD CONSTRAINT "lease_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease" ADD CONSTRAINT "lease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease" ADD CONSTRAINT "lease_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_refundOfPaymentId_fkey" FOREIGN KEY ("refundOfPaymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "ledger_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credential" ADD CONSTRAINT "access_credential_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credential" ADD CONSTRAINT "access_credential_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "access_grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_credential" ADD CONSTRAINT "access_credential_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice" ADD CONSTRAINT "notice_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice" ADD CONSTRAINT "notice_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma's schema language cannot express. Kept in SQL so the
-- database enforces them for every writer, not just the app.
-- ---------------------------------------------------------------------------

-- Master PRD §7.5: a Unit has at most one active Lease. "Active" is any lease
-- that still occupies the unit — everything except `ended` and soft-deleted rows.
CREATE UNIQUE INDEX "lease_one_active_per_unit"
    ON "lease" ("unitId")
    WHERE "status" <> 'ended' AND "deletedAt" IS NULL;

-- Billing day must be valid in every month, including February.
ALTER TABLE "lease"
    ADD CONSTRAINT "lease_billing_day_range"
    CHECK ("billingDay" BETWEEN 1 AND 28);

-- Money is integer cents and these totals are never negative; refunds and
-- credits are expressed as signed ledger entries, not negative invoices.
ALTER TABLE "invoice"
    ADD CONSTRAINT "invoice_amounts_non_negative"
    CHECK ("subtotalCents" >= 0 AND "taxCents" >= 0 AND "discountCents" >= 0
           AND "totalCents" >= 0 AND "amountPaidCents" >= 0);

-- A payment allocation can never exceed the payment or apply a negative amount.
ALTER TABLE "payment_allocation"
    ADD CONSTRAINT "payment_allocation_amount_positive"
    CHECK ("amountCents" > 0);

-- A consent record belongs to exactly one subject (D-8).
ALTER TABLE "consent"
    ADD CONSTRAINT "consent_single_subject"
    CHECK (("tenantId" IS NOT NULL) <> ("leadId" IS NOT NULL));
