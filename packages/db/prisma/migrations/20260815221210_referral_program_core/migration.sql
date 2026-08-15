-- CreateEnum
CREATE TYPE "ReferralState" AS ENUM ('shared', 'pending', 'earned', 'refused', 'expired', 'clawed_back');

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "refereeRewardCents" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "referralAnnualCap" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "referralCrossFacility" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralInviteExpiryDays" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "referralMinimumStayDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "referralOpenInviteCap" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "referralRewardCents" INTEGER NOT NULL DEFAULT 5000;

-- CreateTable
CREATE TABLE "referral_invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerTenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "redeemedAt" TIMESTAMPTZ(6),
    "redeemedByReferralId" TEXT,

    CONSTRAINT "referral_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "referrerTenantId" TEXT NOT NULL,
    "refereeLeadId" TEXT,
    "refereeTenantId" TEXT,
    "refereeLeaseId" TEXT,
    "facilityId" TEXT NOT NULL,
    "state" "ReferralState" NOT NULL DEFAULT 'shared',
    "refusedReason" TEXT,
    "qualifiedAt" TIMESTAMPTZ(6),
    "referrerRewardCents" INTEGER NOT NULL DEFAULT 0,
    "refereeRewardCents" INTEGER NOT NULL DEFAULT 0,
    "referrerRewardInvoiceId" TEXT,
    "refereeRewardInvoiceId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_invite_code_key" ON "referral_invite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_invite_redeemedByReferralId_key" ON "referral_invite"("redeemedByReferralId");

-- CreateIndex
CREATE INDEX "referral_invite_referrerTenantId_redeemedAt_idx" ON "referral_invite"("referrerTenantId", "redeemedAt");

-- CreateIndex
CREATE INDEX "referral_invite_facilityId_idx" ON "referral_invite"("facilityId");

-- CreateIndex
CREATE INDEX "referral_refereeTenantId_state_idx" ON "referral"("refereeTenantId", "state");

-- CreateIndex
CREATE INDEX "referral_referrerTenantId_state_idx" ON "referral"("referrerTenantId", "state");

-- CreateIndex
CREATE INDEX "referral_facilityId_qualifiedAt_idx" ON "referral"("facilityId", "qualifiedAt");

-- AddForeignKey
ALTER TABLE "referral_invite" ADD CONSTRAINT "referral_invite_referrerTenantId_fkey" FOREIGN KEY ("referrerTenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_invite" ADD CONSTRAINT "referral_invite_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "referral_invite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_referrerTenantId_fkey" FOREIGN KEY ("referrerTenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_refereeTenantId_fkey" FOREIGN KEY ("refereeTenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_refereeLeadId_fkey" FOREIGN KEY ("refereeLeadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_refereeLeaseId_fkey" FOREIGN KEY ("refereeLeaseId") REFERENCES "lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral" ADD CONSTRAINT "referral_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
