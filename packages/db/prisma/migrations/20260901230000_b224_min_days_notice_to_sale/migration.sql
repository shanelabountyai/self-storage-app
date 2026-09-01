-- B-224 / D-10. Days required between the served lien notice's own deadline
-- and the sale, on top of that deadline.
--
-- Defaults to 0 deliberately. The deadline comparison is the hard rule and is
-- correct with no number at all, so every existing facility gets the new
-- refusal and no margin it did not ask for. A non-zero default would have
-- retroactively blocked sales already scheduled inside it.
ALTER TABLE "delinquency_timeline" ADD COLUMN "minDaysNoticeToSale" INTEGER NOT NULL DEFAULT 0;
