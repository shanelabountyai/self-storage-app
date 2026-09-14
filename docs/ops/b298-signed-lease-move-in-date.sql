-- Scope of the wrong move-in date on signed leases (B-298, D-139).
-- Read-only. Run against PRODUCTION:
--
--   npx dotenv -e .env.prod-ops -- sh -c 'psql "$DIRECT_URL" -f docs/ops/b298-signed-lease-move-in-date.sql'
--
-- WHAT WENT WRONG. `renderLease` took the renter's chosen start date — which
-- arrives from an `<input type="date">` as UTC midnight — and rendered it in
-- the FACILITY's timezone, landing on 7pm the previous day at any US facility.
-- So the document's move-in date field read one day early, while the
-- first-payment sentence three fields above it had its own UTC exception and
-- was right. Billing was never wrong: `billingDay` was derived from a business
-- date computed beside the column, not from the rendered value. The defect is
-- that a signed document states a date its own next paragraph contradicts.
--
-- THESE DOCUMENTS CANNOT BE CORRECTED. Re-rendering changes `contentHash`, and
-- `document_signature."signedContentHash"` then no longer covers what is on
-- file — which is the entire point of storing the two separately (PRD 01
-- FR-4.2). Any remedy is a NEW document beside the original, never an edit.
--
-- STILL LIVE. B-298 fixed this in the tree on 2026-09-12 (e605fcd) and has not
-- deployed, so there is no upper bound on the affected set yet. Run it again
-- after the deploy.
--
-- TWO THINGS THAT LOOK RIGHT AND ARE NOT — both cost a pass here already:
--
--   1. A signed lease's `document."subjectType"` is 'CheckoutSessionUnit',
--      NOT 'lease', and its `subjectId` is a basket line — so there is no
--      `document.subjectId = lease.id` join, and one returns zero rows on a
--      fully-populated database. ('Lease' with a capital L is the NOTICE
--      subject, which is a different document type.) The lease is reached
--      through the session: line -> checkoutSession -> (tenantId, unitId).
--
--   2. The column's own shape can no longer tell an affected row from a safe
--      one. A walk-in wrote a real instant (2pm local, say) and rendered back
--      CORRECTLY; only a chosen future date arrived as UTC midnight and came
--      back a day early — but B-298's migration normalised every row to UTC
--      midnight. "The start date is a later calendar day than the day the
--      lease was created, in the facility's own zone" asks the same question
--      and survives the backfill.
--
-- Row 2 of the output is the guard against a false zero: if `unresolved` is
-- large, the join failed and the answer is NOT "nobody was affected".

\echo '== 1. Affected signed leases, by facility =='

WITH signed_lease AS (
  SELECT d.id AS document_id,
         d."createdAt" AS doc_created,
         d."facilityId",
         ds."signedAt",
         csu."unitId",
         cs."tenantId"
  FROM document d
  JOIN document_signature ds     ON ds."documentId" = d.id
  JOIN checkout_session_unit csu ON csu.id = d."subjectId"
  JOIN checkout_session cs       ON cs.id = csu."checkoutSessionId"
  WHERE d.type = 'lease'
    AND d."subjectType" = 'CheckoutSessionUnit'
    AND d."deletedAt" IS NULL
    AND csu."unitId" IS NOT NULL
    AND cs."tenantId" IS NOT NULL
),
resolved AS (
  SELECT s.*, f.name AS facility, f.timezone, l.id AS lease_id,
         l."startDate", l."createdAt" AS lease_created
  FROM signed_lease s
  JOIN facility f ON f.id = s."facilityId"
  -- LEFT, deliberately: a line that resolves to no lease must be COUNTED as
  -- unresolved below rather than silently dropped out of the total.
  LEFT JOIN LATERAL (
    SELECT l.id, l."startDate", l."createdAt"
    FROM lease l
    WHERE l."unitId" = s."unitId" AND l."tenantId" = s."tenantId"
    -- The same tenant can rent the same unit twice; take the lease created
    -- nearest the document rather than filtering on status, because a renter
    -- who has since moved out still signed a document that states a wrong date.
    ORDER BY abs(extract(epoch FROM (l."createdAt" - s.doc_created)))
    LIMIT 1
  ) l ON true
)
SELECT facility,
       timezone,
       count(*) AS signed_leases_affected,
       min("signedAt") AS first_signed,
       max("signedAt") AS last_signed
FROM resolved
WHERE lease_id IS NOT NULL
  -- West of UTC is where the render lands on the previous day. A live offset
  -- rather than a hardcoded zone list, so it stays true if a facility is ever
  -- added outside Texas.
  AND (now() AT TIME ZONE timezone) < (now() AT TIME ZONE 'UTC')
  -- The renter picked a future start date; a same-day walk-in rendered right.
  AND ("startDate" AT TIME ZONE 'UTC')::date > (lease_created AT TIME ZONE timezone)::date
GROUP BY facility, timezone
ORDER BY signed_leases_affected DESC;

\echo '== 2. Join health. A large `unresolved` means the count above is wrong, not zero. =='

SELECT count(*) FILTER (WHERE l.id IS NOT NULL) AS resolved_to_a_lease,
       count(*) FILTER (WHERE l.id IS NULL)     AS unresolved,
       count(*)                                 AS signed_lease_documents
FROM document d
JOIN document_signature ds     ON ds."documentId" = d.id
JOIN checkout_session_unit csu ON csu.id = d."subjectId"
JOIN checkout_session cs       ON cs.id = csu."checkoutSessionId"
LEFT JOIN LATERAL (
  SELECT l.id FROM lease l
  WHERE l."unitId" = csu."unitId" AND l."tenantId" = cs."tenantId"
  LIMIT 1
) l ON true
WHERE d.type = 'lease' AND d."subjectType" = 'CheckoutSessionUnit' AND d."deletedAt" IS NULL;

-- Per-renter list, for a notification. Deliberately left commented: run it only
-- once the count above is known AND the owner has decided to contact anybody.
--
-- WITH signed_lease AS ( ...the CTE above... )
-- SELECT t.email, t."firstName", f.name AS facility, u.number AS unit,
--        (l."startDate" AT TIME ZONE 'UTC')::date     AS correct_move_in,
--        (l."startDate" AT TIME ZONE 'UTC')::date - 1 AS date_the_document_states,
--        s."signedAt"
-- FROM ... JOIN tenant t ON t.id = l."tenantId" JOIN unit u ON u.id = l."unitId"
-- ORDER BY s."signedAt";
