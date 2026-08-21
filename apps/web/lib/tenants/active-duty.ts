import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { holdIsActive } from '@storage/core/holds'

// PRD 02 §4.9 US-42 / PRD 01 US-501 step 4 (B-121, owner decision D-49).
// Turning the tenant's own active-duty declaration into the hold that actually
// stops the pipeline.
//
// ── What was broken ──────────────────────────────────────────────────────────
//
// `military_scra` has existed in the holds catalog since B-096 with the right
// restrictions on it — no sale, no access suspension, no collections — and it
// was raised ONLY by hand. `Tenant.activeDutyMilitary` has been collected at
// the lease step since B-112 and read by nothing. So a renter who ticked the
// box was overlocked, dunned and auctioned exactly like anybody else, and the
// record showed that we asked and stored the answer. That is worse than never
// asking: 50 U.S.C. §3958 restricts enforcement against a servicemember's
// stored property without a court order, and the file proves we were told.
//
// ── Why the hold is a real row and not a derived effect ──────────────────────
//
// Deriving `halt_dunning` straight from the boolean would need no table and no
// migration, and it was the first thing tried. It is wrong: a declaration is
// not proof, a tick can be a mistake, and service ends. US-42 requires lifting
// a `military_scra` hold to take manager-or-above, and a derived effect cannot
// be lifted by anybody — a tenant who ticked the wrong box would be frozen out
// of autopay forever with no path back. A row can be lifted, by a manager, with
// a reason, and the lift is audited. That is the whole point of the mechanism
// B-096 built.
//
// ── Why it is system-placed ──────────────────────────────────────────────────
//
// There is no staff member at a web move-in, and on the staff path the hold
// deliberately reaches leases at facilities the person setting the flag may not
// have access to (below). Attributing it to a person would be a lie in the one
// record whose value is that it is not.

/// The hold's own reason line, which is what a staffer reads on the banner
/// before deciding anything. Names where the declaration came from, because
/// "somebody said so" and "the tenant told us themselves, on this date" are
/// different facts to whoever has to act on it.
function reasonFor(source: ActiveDutySource): string {
  return REASONS[source]
}

const REASONS: Record<ActiveDutySource, string> = {
  checkout: 'Raised automatically: the tenant declared active-duty military service when signing the lease.',
  staff: 'Raised automatically: a staff member recorded the tenant as active-duty military.',
  /// B-137. A transfer opens a NEW lease, so the protection has to be re-placed
  /// on it or the ladder runs on a servicemember who only changed units. Its own
  /// line rather than reusing `checkout`: nobody signed anything today, and the
  /// staffer reading the banner needs to know where the declaration came from.
  transfer: 'Raised automatically: carried onto this lease when the tenant transferred units, from their active-duty declaration.',
}

export type ActiveDutySource = 'checkout' | 'staff' | 'transfer'

/// Places the SCRA hold on every lease this tenant holds that does not already
/// have one in force.
///
/// EVERY lease, not the one being signed — the protection attaches to the
/// person, not to a unit, so a servicemember renting at two sites is protected
/// at both. This deliberately ignores the acting staffer's facility scope: a
/// counter staffer at Austin who records the declaration protects the tenant's
/// Dallas lease too, because refusing to would leave half a servicemember
/// protected and the SCRA does not care about our facility boundaries. The
/// permission check belongs on the act of recording the DECLARATION, which is
/// where the caller does it, not on the protection that follows from it.
///
/// Idempotent. A second move-in, a re-run, or a staffer re-ticking the box
/// finds the live hold and adds nothing — checked per lease against the same
/// `holdIsActive` every consumer uses, so a hold with a past end date or one a
/// manager already lifted correctly does NOT suppress a fresh one.
///
/// Ended leases are skipped: the engine already halts them as `moved_out`, and
/// back-filling holds across a decade of history would bury the live ones.
///
/// Reads the flag ITSELF rather than trusting the caller to have checked. Both
/// current call sites do check, and a third one that forgot would place an SCRA
/// hold on somebody who never claimed one — freezing a civilian's autopay and
/// needing a manager to undo it. The guard belongs where it cannot be skipped.
export async function syncActiveDutyHolds(
  tenantId: string,
  source: ActiveDutySource,
  client: Prisma.TransactionClient | typeof prisma = prisma,
  asOf: Date = new Date(),
): Promise<{ placed: string[] }> {
  if (!(await isActiveDuty(tenantId, client))) return { placed: [] }

  const leases = await client.lease.findMany({
    where: { tenantId, status: { not: 'ended' } },
    select: {
      id: true,
      facilityId: true,
      holds: {
        where: { type: 'military_scra' },
        select: { type: true, effectiveFrom: true, effectiveTo: true, liftedAt: true },
      },
    },
  })

  const placed: string[] = []
  for (const lease of leases) {
    if (lease.holds.some((hold) => holdIsActive(hold, asOf))) continue

    const hold = await client.leaseHold.create({
      data: {
        leaseId: lease.id,
        type: 'military_scra',
        reason: reasonFor(source),
        effectiveFrom: asOf,
        effectiveTo: null,
        placedByStaffId: null,
      },
      select: { id: true },
    })

    await recordAudit(
      {
        actor: { type: 'system', label: 'SCRA declaration' },
        action: 'hold.placed',
        entityType: 'Lease',
        entityId: lease.id,
        facilityId: lease.facilityId,
        reasonCode: 'military_scra',
        context: { holdId: hold.id, type: 'military_scra', source, automatic: true },
      },
      client,
    )

    placed.push(lease.id)
  }

  return { placed }
}

/// Whether this tenant is declared active-duty, for the callers that only need
/// the answer and not the sync.
export async function isActiveDuty(
  tenantId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: { activeDutyMilitary: true },
  })
  return tenant?.activeDutyMilitary === true
}
