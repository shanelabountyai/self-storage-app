-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actorStaffId_fkey";

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_facilityId_fkey";

-- CreateIndex
CREATE INDEX "audit_log_actorStaffId_occurredAt_idx" ON "audit_log"("actorStaffId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_action_occurredAt_idx" ON "audit_log"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_occurredAt_idx" ON "audit_log"("occurredAt");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only enforcement for the audit log (master PRD §7.1, PRD 02 US-38).
--
-- The application has no code path that updates or deletes an audit entry, but
-- "we didn't write one" is not a guarantee — this makes it one, for every
-- writer including psql and future migrations.
--
-- Retention is >= 7 years (US-38). When a purge is eventually needed it is a
-- deliberate operation requiring DDL privileges:
--     DROP TRIGGER audit_log_no_delete ON audit_log;
--     DELETE FROM audit_log WHERE "occurredAt" < now() - interval '7 years';
--     CREATE TRIGGER audit_log_no_delete ...   -- restore from this file
-- That friction is the point; there is deliberately no in-band escape hatch.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Row-level triggers never see TRUNCATE, so it needs its own statement-level one.
CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON "audit_log"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- An entry must identify who acted: staff carry a user id, tenants and system
-- actors carry a label.
ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_actor_identified"
    CHECK (
        ("actorType" = 'staff' AND "actorStaffId" IS NOT NULL)
        OR ("actorType" <> 'staff' AND "actorLabel" IS NOT NULL)
    );
