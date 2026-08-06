-- B-053 / PRD 05 CN-17. Per-facility sender identity.
--
-- The From address stays on the shared authenticated domain (SPF/DKIM are set
-- up there); the facility's own inbox is reached via reply-to.
ALTER TABLE "facility"
  ADD COLUMN "emailFromName" TEXT,
  ADD COLUMN "emailReplyTo" TEXT;
