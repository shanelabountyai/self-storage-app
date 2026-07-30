-- CreateEnum
CREATE TYPE "AuthAudience" AS ENUM ('tenant', 'staff');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('magic_link', 'password_reset');

-- AlterTable
ALTER TABLE "staff_user" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(6),
ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(6),
ADD COLUMN     "passwordHash" TEXT;

-- CreateTable
CREATE TABLE "auth_token" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "audience" "AuthAudience" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "audience" "AuthAudience" NOT NULL,
    "ipAddress" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_token_tokenHash_key" ON "auth_token"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_token_subjectId_purpose_idx" ON "auth_token"("subjectId", "purpose");

-- CreateIndex
CREATE INDEX "auth_token_expiresAt_idx" ON "auth_token"("expiresAt");

-- CreateIndex
CREATE INDEX "login_attempt_email_audience_attemptedAt_idx" ON "login_attempt"("email", "audience", "attemptedAt");

-- CreateIndex
CREATE INDEX "login_attempt_ipAddress_attemptedAt_idx" ON "login_attempt"("ipAddress", "attemptedAt");

-- ---------------------------------------------------------------------------
-- Auth invariants the schema language cannot express.
-- ---------------------------------------------------------------------------

-- A token is single-use and time-boxed (PRD 01 FR-5.2). Expiry is enforced at
-- read time; this stops a row from being written already-consumed or backdated.
ALTER TABLE "auth_token"
    ADD CONSTRAINT "auth_token_used_after_created"
    CHECK ("usedAt" IS NULL OR "usedAt" >= "createdAt");

ALTER TABLE "auth_token"
    ADD CONSTRAINT "auth_token_expires_after_created"
    CHECK ("expiresAt" > "createdAt");

-- Only one live magic link or reset link per subject at a time: minting a new
-- one must invalidate the old. Partial index over unused, so consumed tokens
-- stay queryable for the audit trail.
CREATE UNIQUE INDEX "auth_token_one_live_per_subject_purpose"
    ON "auth_token" ("subjectId", "purpose")
    WHERE "usedAt" IS NULL;
