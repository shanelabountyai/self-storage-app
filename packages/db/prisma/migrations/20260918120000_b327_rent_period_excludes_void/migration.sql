-- B-327. A voided rent invoice no longer holds its period.
--
-- `invoice_one_rent_per_period` is the rent generator's idempotency key, and it
-- counted voided rows — so a manager who voided July's rent because the rate
-- was wrong could never bill July again: `createInvoiceForPeriod` caught the
-- P2002 and skipped the period for ever. `voidRentInvoice` now unwinds the
-- promotion period and referral rewards the voided invoice consumed, in the
-- same transaction, so the re-raise carries what the original carried. Without
-- that half this index change would have re-billed the period at full price.
DROP INDEX "invoice_one_rent_per_period";

CREATE UNIQUE INDEX "invoice_one_rent_per_period"
  ON "invoice" ("leaseId", "periodStart")
  WHERE "kind" = 'rent' AND "status" <> 'void';
