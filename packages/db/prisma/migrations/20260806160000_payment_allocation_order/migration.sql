-- B-048 / PRD 02 US-22. Configurable partial-payment allocation order.
ALTER TABLE "facility"
  ADD COLUMN "paymentAllocationOrder" TEXT[] NOT NULL DEFAULT ARRAY['tax', 'fee', 'protection', 'rent'];
