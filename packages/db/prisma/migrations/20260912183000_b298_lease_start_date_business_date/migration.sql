-- B-298 / D-139. `Lease.startDate` is a facility-local CALENDAR DAY carried at
-- UTC midnight, the same convention as `Invoice.issueDate` and as
-- `businessDateFor`'s return value.
--
-- Until now the column held two different things. `provision.ts` wrote
-- `new Date()` for a same-day move-in and the renter's chosen calendar day
-- (already UTC midnight) for a scheduled one, so a report bucketing move-ins
-- by month got some leases by instant and some by date and no range bound was
-- right for both. Transfers had always written a calendar day, which is what
-- settles which of the two meanings is the real one.
--
-- The discriminator is exact, not a heuristic: a row already at UTC midnight is
-- a calendar day and must NOT be converted — putting it through
-- `AT TIME ZONE` again is the same double conversion that put a Chicago lease
-- on the 19th when the renter picked the 20th. Only the rows carrying a real
-- time of day are instants, and they are the only ones touched.
--
-- No schema change: the column stays `timestamptz`, because that is already how
-- this codebase carries a business date (`Invoice.issueDate`), and narrowing it
-- to `date` would rewrite every read of it for no correctness gain.
UPDATE "lease" l
SET "startDate" = ((l."startDate" AT TIME ZONE f."timezone")::date)::timestamp AT TIME ZONE 'UTC'
FROM "facility" f
WHERE f."id" = l."facilityId"
  AND l."startDate" <> date_trunc('day', l."startDate");

-- The move-in `LeaseRateChange` is written from the same value in the same
-- transaction (`provision.ts`), so it carries the same split and is normalised
-- with it — otherwise "when did this lease's rate last change" disagrees with
-- "when did this lease start" for every walk-in already in the table.
UPDATE "lease_rate_change" rc
SET "effectiveFrom" = ((rc."effectiveFrom" AT TIME ZONE f."timezone")::date)::timestamp AT TIME ZONE 'UTC'
FROM "lease" l, "facility" f
WHERE l."id" = rc."leaseId"
  AND f."id" = l."facilityId"
  AND rc."reason" = 'move_in'
  AND rc."effectiveFrom" <> date_trunc('day', rc."effectiveFrom");
