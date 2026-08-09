-- B-068 / PRD 04 US-8 AC4. Rate limiting, per submitter.
--
-- A keyed SHA-256 of the IP, never the address itself. An IP is personal data
-- and this needs to answer exactly one question — "has this submitter been here
-- five times in ten minutes?" — which a one-way hash answers just as well.
-- Keyed rather than plain because the IPv4 space is small enough to enumerate
-- against an unkeyed digest.
ALTER TABLE "lead" ADD COLUMN "submitterHash" TEXT;
CREATE INDEX "lead_submitterHash_createdAt_idx" ON "lead" ("submitterHash", "createdAt");
