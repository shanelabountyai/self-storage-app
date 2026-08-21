import { prisma } from "@storage/db";

// PRD 02 §4.9 US-41, §4.6 US-26, §5.5 FR-22 (B-115, UX review 2026-08-12
// finding 9). `Task` has carried `entityType`/`entityId` since B-095 and
// neither the Tasks screen nor the Delinquency queue ever read them, so a
// card said "Fit an overlock / Lease · Aug 12 / Unassigned" — no tenant, no
// unit, no link — and the staffer memorised nothing, went to Tenants,
// searched, and came back.
//
// One resolver, called once per list (`facilityTasks`), because both screens
// read the same `Task` rows (B-095's rule: `/admin/delinquency` is a filtered
// view of `/admin/tasks`, not a table of its own) and a subject worked out
// twice is a subject that can disagree with itself.

export type TaskSubject = { label: string; href: string | null };

/// Batched by entityType so N tasks cost one query per type in play, not N
/// queries — the same shape `tenant-list.ts` uses for balances.
export async function resolveTaskSubjects(
  tasks: readonly { entityType: string; entityId: string }[],
): Promise<Map<string, TaskSubject>> {
  const byType = new Map<string, Set<string>>();
  for (const task of tasks) {
    const ids = byType.get(task.entityType) ?? new Set<string>();
    ids.add(task.entityId);
    byType.set(task.entityType, ids);
  }

  const result = new Map<string, TaskSubject>();
  const key = (entityType: string, entityId: string) =>
    `${entityType}:${entityId}`;

  const leaseIds = byType.get("Lease");
  if (leaseIds) {
    const leases = await prisma.lease.findMany({
      where: { id: { in: [...leaseIds] } },
      select: {
        id: true,
        tenantId: true,
        tenant: { select: { firstName: true, lastName: true } },
        unit: { select: { number: true } },
      },
    });
    for (const lease of leases) {
      result.set(
        key("Lease", lease.id),
        leaseSubject(lease.tenantId, lease.tenant, lease.unit.number),
      );
    }
  }

  const tenantIds = byType.get("Tenant");
  if (tenantIds) {
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: [...tenantIds] } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const tenant of tenants) {
      result.set(key("Tenant", tenant.id), {
        label: `${tenant.firstName} ${tenant.lastName}`,
        href: `/admin/tenants/${tenant.id}`,
      });
    }
  }

  const invoiceIds = byType.get("Invoice");
  if (invoiceIds) {
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: [...invoiceIds] } },
      select: {
        id: true,
        lease: {
          select: {
            tenantId: true,
            tenant: { select: { firstName: true, lastName: true } },
            unit: { select: { number: true } },
          },
        },
      },
    });
    for (const invoice of invoices) {
      result.set(
        key("Invoice", invoice.id),
        leaseSubject(
          invoice.lease.tenantId,
          invoice.lease.tenant,
          invoice.lease.unit.number,
        ),
      );
    }
  }

  const paymentIds = byType.get("Payment");
  if (paymentIds) {
    const payments = await prisma.payment.findMany({
      where: { id: { in: [...paymentIds] } },
      select: {
        id: true,
        tenantId: true,
        tenant: { select: { firstName: true, lastName: true } },
      },
    });
    for (const payment of payments) {
      result.set(key("Payment", payment.id), {
        label: `${payment.tenant.firstName} ${payment.tenant.lastName}`,
        href: `/admin/tenants/${payment.tenantId}`,
      });
    }
  }

  const leadIds = byType.get("Lead");
  if (leadIds) {
    const leads = await prisma.lead.findMany({
      where: { id: { in: [...leadIds] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
      },
    });
    for (const lead of leads) {
      const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
      result.set(key("Lead", lead.id), {
        label: name || lead.phone || lead.email || "New inquiry",
        href: `/admin/leads/${lead.id}`,
      });
    }
  }

  const gateCommandIds = byType.get("GateCommand");
  if (gateCommandIds) {
    for (const [id, subject] of await resolveGateCommandSubjects([
      ...gateCommandIds,
    ])) {
      result.set(key("GateCommand", id), subject);
    }
  }

  // B-135. `inbound_sms_review` points at the domain event rather than at the
  // tenant, because the tenant's own words live in its payload and one task
  // per message is the whole point (a second question the same afternoon must
  // not be swallowed by the first task's idempotency key). Same shape as
  // `GateCommand` above: the task names an entity, this reads the detail off
  // it and puts it on the card, so a staffer knows what they are opening.
  const eventIds = byType.get("DomainEvent");
  if (eventIds) {
    const events = await prisma.domainEvent.findMany({
      where: { id: { in: [...eventIds] } },
      select: { id: true, payload: true },
    });
    const tenantIds = events
      .map((event) => (event.payload as { tenantId?: string | null })?.tenantId)
      .filter((id): id is string => typeof id === "string");
    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const byId = new Map(tenants.map((tenant) => [tenant.id, tenant]));

    for (const event of events) {
      const payload = (event.payload ?? {}) as {
        tenantId?: string | null;
        body?: string;
      };
      const tenant = payload.tenantId ? byId.get(payload.tenantId) : undefined;
      const name = tenant
        ? `${tenant.firstName} ${tenant.lastName}`
        : "Unknown number";
      result.set(key("DomainEvent", event.id), {
        // The message itself, on the card. A queue item that says only "a
        // tenant texted back" makes a staffer open it to find out whether it
        // is urgent — which is the click B-115 removed everywhere else.
        label: payload.body
          ? `${name} — “${truncate(payload.body, 80)}”`
          : name,
        href: payload.tenantId ? `/admin/tenants/${payload.tenantId}` : null,
      });
    }
  }

  const facilityIds = byType.get("Facility");
  if (facilityIds) {
    // `gate_drift_review` and `daily_walkthrough` are the whole facility's
    // business, not one tenant's — there is no narrower subject to resolve.
    // The page header already names the facility, so this is a plain-words
    // acknowledgement rather than the raw model name, and never a link.
    for (const id of facilityIds) {
      result.set(key("Facility", id), { label: "Facility-wide", href: null });
    }
  }

  return result;
}

/// Long enough to tell a gate fault from a billing question at a glance, short
/// enough that one rambling text does not push every other card off the
/// screen.
///
/// B-143: this comment used to claim the full message was "on the tenant's own
/// record", and for two days it was not — `sms.inbound_received` had an emit
/// site, a catalog entry and no reader anywhere, so the words past character
/// 80 (the sentence with the unit number in it) reached nobody. The full body
/// now renders in Communication history on the tenant profile, which is where
/// this card's `href` already pointed. Keep the two in step: a truncation is
/// only honest while something downstream shows the rest.
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function leaseSubject(
  tenantId: string,
  tenant: { firstName: string; lastName: string },
  unitNumber: string,
): TaskSubject {
  return {
    label: `Unit ${unitNumber} — ${tenant.firstName} ${tenant.lastName}`,
    href: `/admin/tenants/${tenantId}`,
  };
}

/// `gate_manual_action`'s own instruction-builder (`manual-adapter.ts`)
/// prefers the credential's grant over the command's own `grantId` — a
/// credential names the exact code being keyed in, which is closer to "who is
/// standing at the gate" than the command's grant, which can be null on a
/// suspend/revoke that has no credential at all. Mirrored here rather than
/// reimplemented differently.
async function resolveGateCommandSubjects(
  commandIds: string[],
): Promise<Map<string, TaskSubject>> {
  const commands = await prisma.gateCommand.findMany({
    where: { id: { in: commandIds } },
    select: { id: true, grantId: true, credentialId: true },
  });

  const credentialIds = commands
    .map((c) => c.credentialId)
    .filter((id): id is string => id !== null);
  const credentials = credentialIds.length
    ? await prisma.accessCredential.findMany({
        where: { id: { in: credentialIds } },
        select: {
          id: true,
          grant: {
            select: {
              tenantId: true,
              tenant: { select: { firstName: true, lastName: true } },
            },
          },
        },
      })
    : [];
  const credentialById = new Map(credentials.map((c) => [c.id, c]));

  const directGrantIds = commands
    .filter((c) => !c.credentialId && c.grantId)
    .map((c) => c.grantId as string);
  const grants = directGrantIds.length
    ? await prisma.accessGrant.findMany({
        where: { id: { in: directGrantIds } },
        select: {
          id: true,
          tenantId: true,
          tenant: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const grantById = new Map(grants.map((g) => [g.id, g]));

  const result = new Map<string, TaskSubject>();
  for (const command of commands) {
    const viaCredential = command.credentialId
      ? credentialById.get(command.credentialId)
      : undefined;
    const grant = viaCredential
      ? viaCredential.grant
      : command.grantId
        ? grantById.get(command.grantId)
        : undefined;

    result.set(
      command.id,
      grant?.tenant
        ? {
            label: `${grant.tenant.firstName} ${grant.tenant.lastName}`,
            href: `/admin/tenants/${grant.tenantId}`,
          }
        : // A grant for an authorized person rather than the tenant themselves,
          // or a command with neither a credential nor a grant left to read —
          // named honestly rather than guessed at.
          { label: "Access change", href: null },
    );
  }
  return result;
}

/// A plain-words fallback for a subject the resolver has nothing for — most
/// often a `findMany` that came back short because the row it names was
/// deleted. Unlinked rather than broken (the row's own requirement): a task
/// still shows and can still be completed, it just names what it cannot find
/// rather than a raw id or a dead link.
const MISSING_SUBJECT_LABEL: Record<string, string> = {
  Lease: "This lease no longer exists.",
  Tenant: "This tenant no longer exists.",
  Invoice: "This invoice no longer exists.",
  Payment: "This payment no longer exists.",
  Lead: "This inquiry no longer exists.",
  GateCommand: "This access change no longer exists.",
  Facility: "This facility no longer exists.",
};

export function fallbackSubject(entityType: string): TaskSubject {
  return {
    label:
      MISSING_SUBJECT_LABEL[entityType] ??
      "The subject of this task no longer exists.",
    href: null,
  };
}
