-- D-111 / B-238. `tenant.email` stops being required and unique.
--
-- Answer (A): nullable AND non-unique. Null means the renter has no email
-- address -- the contractor, the elderly tenant whose daughter handles it --
-- and phone or the postal address is the alternative contact of record.
-- Non-unique lets a husband and wife each hold an account on one household
-- inbox; `findAccount` refuses to resolve a shared address to either of them
-- rather than guessing which person signed in.
--
-- The unique constraint carried the only index on this column, and every
-- sign-in, magic link and checkout looks a tenant up by address, so a plain
-- index replaces it.
--
-- **No backfill.** Existing `nobody@example.com`-style placeholders are left
-- exactly as typed: they are a record of what staff entered, and rewriting
-- them to NULL from a migration would destroy that without anyone deciding to.
-- Clearing one is a staff action on the tenant screen, not a schema change.

-- DropIndex
DROP INDEX "tenant_email_key";

-- AlterTable
ALTER TABLE "tenant" ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "tenant_email_idx" ON "tenant"("email");
