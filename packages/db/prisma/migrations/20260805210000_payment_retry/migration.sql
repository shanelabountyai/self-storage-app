-- B-046 / PRD 02 US-20. Failed-payment retry.

-- AlterTable: the retry schedule, in days after the invoice's ORIGINAL due
-- date. US-20's own +1/+3/+5 is the default; empty means no retries.
ALTER TABLE "facility"
  ADD COLUMN "paymentRetryDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 3, 5];

-- AlterTable: the provider's machine-readable decline code, beside the human
-- message. The retry schedule branches on this — deciding "has the card
-- expired?" by matching on Stripe's prose is a bug waiting for a reword.
ALTER TABLE "payment"
  ADD COLUMN "failureCode" TEXT;
