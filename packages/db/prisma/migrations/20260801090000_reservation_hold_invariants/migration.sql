-- B-018. Two invariants the reservation service depends on, enforced by the
-- database rather than by the code that happens to write it.
--
-- Prisma's schema language cannot express a partial index, so these live in raw
-- SQL and are mirrored as comments on the model — the same arrangement the
-- lease and auth-token invariants use.

-- A unit can be held by at most one live reservation. This is the backstop for
-- the "two people reserve the last unit at the same moment" race: the service
-- claims a unit with SELECT ... FOR UPDATE SKIP LOCKED so the two transactions
-- pick different rows, and if that ever fails to hold — a new code path, a
-- replica with a different isolation level — the write is rejected instead of
-- quietly double-booking.
--
-- Partial over held-with-a-unit, so cancelled and expired reservations stay
-- queryable for the audit trail and for conversion reporting, and a reservation
-- that names only a unit type does not participate.
CREATE UNIQUE INDEX "reservation_one_held_per_unit"
    ON "reservation" ("unitId")
    WHERE "status" = 'held' AND "unitId" IS NOT NULL;

-- A hold that expires before it starts is not a hold. Cheap, and it turns a
-- whole class of date-arithmetic bug into a write that fails loudly at the
-- point of the mistake.
ALTER TABLE "reservation"
    ADD CONSTRAINT "reservation_expires_after_creation"
    CHECK ("expiresAt" > "createdAt");
