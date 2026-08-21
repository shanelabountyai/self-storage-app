import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../packages/db";
import { routeInboundSms } from "../apps/web/lib/comms/sms-inbound";
import { resolveTaskSubjects } from "../apps/web/lib/admin/task-subjects";
import { tenantProfile } from "../apps/web/lib/admin/tenants";
import type { Actor } from "../apps/web/lib/rbac/actor";
import type { PermissionKey } from "@storage/db/rbac-catalog";

// PRD 05 §8 Phase 3 / PRD 02 US-41 (B-135, D-78), against real rows.
//
// The defect: `sms-webhook/route.ts` handled STOP, HELP, START and YES and
// answered everything else with `<Response/>` — no reply, no record, nobody
// told. The properties worth a database are the ones that make the fix real
// rather than nominal: the words survive, a second message the same afternoon
// is not swallowed by the first one's idempotency key, an unmatched number
// still leaves a record, and a staffer can read what was said without opening
// the task.

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
const suffix = randomUUID().slice(0, 8);

// `senderOf` matches on the LAST 10 DIGITS across every tenant in the
// database, so a fixture phone that is only partly unique is a suite that
// passes until somebody else's fixture happens to end the same way. All ten
// digits are derived from this run's uuid rather than a fixed prefix plus four
// varying characters.
const digits = BigInt(`0x${suffix}`).toString().padStart(10, "4").slice(-10);
const TENANT_PHONE = `+1${digits}`;
// Deliberately not derived from `suffix`: it must match no tenant at all, and
// a digit-shuffle of the tenant's own number is one collision away from doing.
const STRANGER_PHONE = "+19995550000";

let facilityId = "";
let tenantId = "";

/// Enough to read a profile and nothing more — B-143 only follows the card's
/// own href, it does not mutate anything.
function viewerAt(id: string): Actor {
  return {
    kind: "staff",
    staffUserId: "staff-inbound-test",
    assignments: [
      {
        facilityId: id,
        roleKey: "manager",
        rank: 20,
        permissions: new Set<PermissionKey>(["tenants:view"]),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  };
}

describeDb("inbound SMS routing (B-135)", () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Inbound ${suffix}`,
        slug: `inbound-${suffix}`,
        addressLine1: "1 Storage Way",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        timezone: "America/Chicago",
        phone: "512-555-0100",
      },
    });
    facilityId = facility.id;

    const tenant = await prisma.tenant.create({
      data: {
        email: `inbound-${suffix}@example.com`,
        firstName: "Ada",
        lastName: "Texter",
        phone: TENANT_PHONE,
      },
    });
    tenantId = tenant.id;

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    });
    const unit = await prisma.unit.create({
      data: {
        facilityId,
        unitTypeId: unitType.id,
        number: `S-${suffix.slice(0, 4)}`,
        status: "available",
      },
    });
    await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: "active",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        billingDay: 1,
        monthlyRateCents: 10_000,
      },
    });
  });

  afterEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } });
    await prisma.domainEvent.deleteMany({
      where: { name: "sms.inbound_received" },
    });
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await prisma.task.deleteMany({ where: { facilityId } });
    await prisma.domainEvent.deleteMany({ where: { facilityId } });
    await prisma.lease.deleteMany({ where: { facilityId } });
    await prisma.unit.deleteMany({ where: { facilityId } });
    await prisma.unitType.deleteMany({ where: { facilityId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    // The facility deliberately stays, matching every other suite here:
    // `audit_log` is append-only and RESTRICT-references it, so the moment
    // anything in this file audits, a delete would throw — and a throwing
    // `afterAll` leaves the WHOLE fixture behind, which is how a phone-matched
    // lookup like this one starts finding a previous run's tenant.
    await prisma.$disconnect();
  });

  it("records the words and raises a task at the tenant’s facility", async () => {
    const result = await routeInboundSms({
      rawPhone: TENANT_PHONE,
      body: "the gate won’t open",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.facilityName).toBe(`Inbound ${suffix}`);
    // Their OWN site's number goes back in the reply — the counter that can
    // open a gate, not the shared SMS line nobody answers.
    expect(result.facilityPhone).toBe("512-555-0100");

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { name: "sms.inbound_received", facilityId },
    });
    const payload = event.payload as {
      body: string;
      tenantId: string | null;
      phone: string;
    };
    expect(payload.body).toBe("the gate won’t open");
    expect(payload.tenantId).toBe(tenantId);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: result.taskId },
    });
    expect(task.type).toBe("inbound_sms_review");
    expect(task.facilityId).toBe(facilityId);
    expect(task.status).toBe("open");
    // Somebody is waiting on the other end of this one.
    expect(task.priority).toBe("high");
    // The task points at the event, which is where the words are.
    expect(task.entityType).toBe("DomainEvent");
    expect(task.entityId).toBe(event.id);
    expect(task.sourceEventId).toBe(event.id);
  });

  it("does not swallow a second message the same day", async () => {
    // The regression this guards: `createTask` dedupes on
    // (type, entityId, businessDate). Keying the task on the TENANT would make
    // two questions in one afternoon a single task, and the second person's
    // words would be nowhere at all.
    const first = await routeInboundSms({
      rawPhone: TENANT_PHONE,
      body: "I paid yesterday",
    });
    const second = await routeInboundSms({
      rawPhone: TENANT_PHONE,
      body: "also my code stopped working",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(first.taskId).not.toBe(second.taskId);

    expect(
      await prisma.task.count({
        where: { facilityId, type: "inbound_sms_review" },
      }),
    ).toBe(2);

    const bodies = (
      await prisma.domainEvent.findMany({
        where: { name: "sms.inbound_received", facilityId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      })
    ).map((event) => (event.payload as { body: string }).body);
    expect(bodies).toEqual([
      "I paid yesterday",
      "also my code stopped working",
    ]);
  });

  it("still records a message from a number it cannot place, without a task", async () => {
    const result = await routeInboundSms({
      rawPhone: STRANGER_PHONE,
      body: "do you have a 10x20?",
    });
    expect(result).toEqual({ ok: false, reason: "unmatched" });

    // No facility to raise it at — but the message is not simply gone, which
    // is the difference between "we cannot act on this" and the silence this
    // item exists to remove.
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { name: "sms.inbound_received", entityId: "unmatched" },
    });
    expect((event.payload as { body: string }).body).toBe(
      "do you have a 10x20?",
    );
    expect(event.facilityId).toBeNull();
    expect(
      await prisma.task.count({
        where: { type: "inbound_sms_review", facilityId },
      }),
    ).toBe(0);
  });

  it("falls back to the SMS line when the facility has no phone on file", async () => {
    await prisma.facility.update({
      where: { id: facilityId },
      data: { phone: null },
    });
    try {
      const result = await routeInboundSms({
        rawPhone: TENANT_PHONE,
        body: "hello?",
      });
      if (!result.ok) throw new Error("unreachable");
      expect(result.facilityPhone).toBeNull();
    } finally {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { phone: "512-555-0100" },
      });
    }
  });

  it("ignores an empty body rather than claiming a person wrote something", async () => {
    expect(
      await routeInboundSms({ rawPhone: TENANT_PHONE, body: "   " }),
    ).toEqual({
      ok: false,
      reason: "empty",
    });
    // Scoped to this suite's own facility, not a global count: an unscoped
    // assertion over a shared database is a coin toss the moment anything else
    // emits the same event name (this repo's own rule, learned on `audit_log`).
    expect(
      await prisma.domainEvent.count({
        where: { name: "sms.inbound_received", facilityId },
      }),
    ).toBe(0);
  });

  it("puts the message on the task card, so nobody opens it to triage", async () => {
    const result = await routeInboundSms({
      rawPhone: TENANT_PHONE,
      body: "my unit has water in it",
    });
    if (!result.ok) throw new Error("unreachable");
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: result.taskId },
    });

    const subjects = await resolveTaskSubjects([task]);
    const subject = subjects.get(`DomainEvent:${task.entityId}`);
    expect(subject?.label).toBe("Ada Texter — “my unit has water in it”");
    expect(subject?.href).toBe(`/admin/tenants/${tenantId}`);
  });

  it("renders the whole message where the card links (B-143)", async () => {
    // The defect: the card truncates at 80 characters and `sms.inbound_received`
    // had NO read site anywhere, so the rest of a long text — here the third
    // sentence, the one carrying the unit number — reached no human at all.
    // This follows the href the test above pins and asserts the words survive
    // the trip, untruncated.
    const body =
      "Hi, I came by this morning and the office was shut. I have been trying to reach " +
      "someone since Friday about the leak. It is unit B-114 and the box at the back is " +
      "already soaked through.";
    expect(body.length).toBeGreaterThan(80);

    const result = await routeInboundSms({ rawPhone: TENANT_PHONE, body });
    if (!result.ok) throw new Error("unreachable");

    const profile = await tenantProfile(viewerAt(facilityId), tenantId);
    const [received] = profile.inboundSms;
    expect(received?.body).toBe(body);
    // The part the card could never show, and the reason this row existed.
    expect(received?.body).toContain("unit B-114");
    // Same row the task names, so a staffer arriving from the queue is looking
    // at the message they clicked rather than the tenant's most recent one.
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: result.taskId },
    });
    expect(received?.id).toBe(task.entityId);
    // CN-18 masking, on the same terms as an outbound `toAddress`.
    expect(received?.phoneMasked).toBe(`••••${TENANT_PHONE.slice(-4)}`);
  });

  it("truncates a rambling message rather than letting it push the queue off screen", async () => {
    const long = "hello ".repeat(40);
    const result = await routeInboundSms({
      rawPhone: TENANT_PHONE,
      body: long,
    });
    if (!result.ok) throw new Error("unreachable");
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: result.taskId },
    });

    const subject = (await resolveTaskSubjects([task])).get(
      `DomainEvent:${task.entityId}`,
    );
    expect(subject!.label.length).toBeLessThan(120);
    expect(subject!.label).toContain("…");
    // The full text is still on the event — truncation is a display decision.
    const event = await prisma.domainEvent.findUniqueOrThrow({
      where: { id: task.entityId },
    });
    expect((event.payload as { body: string }).body).toBe(long.trim());
  });
});
