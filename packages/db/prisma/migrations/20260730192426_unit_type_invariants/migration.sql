-- ---------------------------------------------------------------------------
-- UnitType invariants missing since B-002: dimensions and rates are physical
-- and financial quantities respectively, and neither should ever be zero or
-- negative, the same reasoning already applied to every other numeric field
-- in this schema.
-- ---------------------------------------------------------------------------

ALTER TABLE "unit_type"
    ADD CONSTRAINT "unit_type_dimensions_positive"
    CHECK ("widthFt" > 0 AND "lengthFt" > 0 AND ("heightFt" IS NULL OR "heightFt" > 0));

ALTER TABLE "unit_type"
    ADD CONSTRAINT "unit_type_rates_non_negative"
    CHECK ("streetRateCents" >= 0 AND "webRateCents" >= 0);

ALTER TABLE "unit_type"
    ADD CONSTRAINT "unit_type_floor_positive"
    CHECK ("floor" > 0);
