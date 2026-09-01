-- B-219, second half. The same client-side timestamp trap on the two other
-- models this repo sorts by and where a tie actually costs something.
--
-- `notice`: `noticesForLease` orders a lease's notices newest-first, and that
-- list IS the lien file. Two notices written back to back shared an instant
-- and the order between them was a coin flip.
--
-- `message`: the tenant profile's communication history is ordered the same
-- way and capped at 20, so a tie could reorder the page AND change which row
-- falls off the end of it.
--
-- `audit_log` is deliberately NOT here: it already orders by
-- `[occurredAt desc, id desc]`, so a tie is resolved deterministically rather
-- than at random. Chronology within one instant is still unknowable there,
-- but nothing reads differently between two runs, which is the defect this
-- row is about.
ALTER TABLE "notice" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp();
ALTER TABLE "message" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp();
