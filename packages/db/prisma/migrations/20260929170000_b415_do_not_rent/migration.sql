-- B-415. A do-not-rent flag on the tenant: null is "not flagged", a value is
-- the flag and its reason.
ALTER TABLE "tenant" ADD COLUMN "doNotRentReason" TEXT;
