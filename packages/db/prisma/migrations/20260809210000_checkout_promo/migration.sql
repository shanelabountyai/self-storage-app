-- B-070 / PRD 04 US-12 AC2. The promotion carried through checkout.
--
-- Held on the session rather than re-evaluated at each step: a promo that ended
-- mid-checkout must not silently change the total somebody already read and
-- agreed to.
ALTER TABLE "checkout_session"
  ADD COLUMN "promotionId" TEXT,
  ADD COLUMN "promoCodeId" TEXT;
