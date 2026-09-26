-- B-399. Why a tenant left, separate from how the lease ended. Additive and
-- nullable: existing leases stay null and report as "not recorded".
CREATE TYPE "MoveOutCause" AS ENUM (
  'price_or_rate_increase', 'moved_away', 'no_longer_needed', 'bought_home',
  'switched_facility', 'service_issue', 'other',
  'system_transfer', 'system_abandonment', 'system_lien_sale'
);

ALTER TABLE "lease"
  ADD COLUMN "moveOutCause" "MoveOutCause",
  ADD COLUMN "moveOutCauseNote" VARCHAR(200);
