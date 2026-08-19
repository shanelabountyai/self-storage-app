import { prisma } from '@storage/db'
import type { ImpersonationEndReason, ImpersonationSubjectType } from '@storage/db'
import type { Actor } from '@/lib/rbac/actor'
import { facilityAccess } from '@/lib/rbac/authorize'

/// PRD 09 §5.5 (B-092). The oversight half, and FR-21 is explicit that it is
/// load-bearing rather than a nicety: D-13a removed tenant notification, so
/// nothing else in the product makes misuse visible. "Phase A only,
/// indefinitely" is the one resting state §8 calls unsafe, and this is what
/// ends it.
///
/// Deliberately free of any `@/auth` import so it stays reachable from Vitest —
/// the screen and the CSV route are the thin session-shaped wrappers, and every
/// decision worth testing is here.

/// FR-20's threshold: how many DISTINCT subjects one impersonator may reach in
/// a single UTC day before the report flags them.
///
/// **A constant, not a column, and that is this repo's own rule rather than a
/// shortcut.** A field that configures behaviour ships with its control or does
/// not ship — five once landed reachable only from a database client and took
/// two clean-up passes to close — and B-091 part 1 settled the same question
/// the same way for the session TTL. OQ-3 asks for "a real N, which needs
/// observed usage", and there is none yet: the permission is owner-only at seed
/// (D-13b) and starts are throttled to ten an hour (SR-7). Tuning a number
/// against no data by putting a box on a screen is not configurability, it is a
/// guess with a form field.
///
/// Five is conservative for the operator this is built for. At 2–10 facilities
/// an owner who opens five different accounts in one day is either having a
/// genuinely bad day or doing something worth a question — which is exactly
/// what a flag is for. FR-20 is emphatic that detection is a REPORTING concern,
/// never a blocking one: nothing here refuses anything.
export const FREQUENCY_FLAG_DISTINCT_SUBJECTS = 5

export type SessionRow = {
  id: string
  impersonatorStaffId: string
  impersonatorName: string
  subjectType: ImpersonationSubjectType
  subjectId: string
  subjectName: string
  /// Facilities the SUBJECT reaches — see `subjectFacilities()` for why this is
  /// what "filterable by facility" has to mean here.
  facilityIds: string[]
  reason: string
  ticketRef: string | null
  startedAt: Date
  expiresAt: Date
  endedAt: Date | null
  endedBy: ImpersonationEndReason | null
  endedByName: string | null
}

function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim()
}

/// Which facilities a session touched.
///
/// `ImpersonationSession` has no `facilityId`, deliberately (B-091 part 1): a
/// session is about a subject, and a subject spans facilities — a tenant with
/// leases at two sites, or an all-facilities staff user, belongs to no single
/// one. FR-19 nonetheless asks for a facility filter, so it has to mean
/// something, and there are two candidates that answer different questions.
///
/// **The subject's facilities, not the impersonator's `facilityScopeSnapshot`.**
/// The question an owner asks is "who looked at accounts at my Dallas site",
/// which is about whose account was opened. The snapshot answers "what could
/// this impersonator have reached at the time", which is evidence about the
/// guard rather than about the visit — it stays on the row for the
/// investigation that does ask it.
///
/// **These are CURRENT facilities, and the screen says so.** A tenant who moved
/// out since is no longer counted at the site they were at, the same "as at
/// now" limitation B-131 fixed for occupancy and which is not worth a second
/// history table for a filter. Naming it beats letting a reader assume the
/// filter is historical.
export async function subjectFacilities(
  subjects: readonly { type: ImpersonationSubjectType; id: string }[],
): Promise<Map<string, string[]>> {
  const tenantIds = subjects.filter((s) => s.type === 'tenant').map((s) => s.id)
  const staffIds = subjects.filter((s) => s.type === 'staff').map((s) => s.id)

  // Two queries for the whole page rather than one per row. The volumes here
  // are small by construction — owner-only at seed, ten starts an hour — so
  // this stays a bulk lookup rather than a join, and the ceiling is a report
  // page that would slow down somewhere past tens of thousands of sessions.
  const [leases, assignments] = await Promise.all([
    tenantIds.length > 0
      ? prisma.lease.findMany({
          where: { tenantId: { in: tenantIds } },
          select: { tenantId: true, facilityId: true },
        })
      : [],
    staffIds.length > 0
      ? prisma.staffFacilityAssignment.findMany({
          where: { staffUserId: { in: staffIds } },
          select: { staffUserId: true, facilityId: true },
        })
      : [],
  ])

  const map = new Map<string, string[]>()
  const add = (key: string, facilityId: string | null) => {
    if (facilityId === null) return
    const existing = map.get(key)
    if (existing) {
      if (!existing.includes(facilityId)) existing.push(facilityId)
    } else {
      map.set(key, [facilityId])
    }
  }
  for (const lease of leases) add(`tenant:${lease.tenantId}`, lease.facilityId)
  for (const assignment of assignments) add(`staff:${assignment.staffUserId}`, assignment.facilityId)
  return map
}

async function decorate(
  rows: readonly {
    id: string
    impersonatorStaffId: string
    subjectType: ImpersonationSubjectType
    subjectId: string
    reason: string
    ticketRef: string | null
    startedAt: Date
    expiresAt: Date
    endedAt: Date | null
    endedBy: ImpersonationEndReason | null
    endedByStaffId: string | null
  }[],
): Promise<SessionRow[]> {
  if (rows.length === 0) return []

  const staffIds = [
    ...new Set([
      ...rows.map((r) => r.impersonatorStaffId),
      ...rows.filter((r) => r.subjectType === 'staff').map((r) => r.subjectId),
      ...rows.map((r) => r.endedByStaffId).filter((id): id is string => id !== null),
    ]),
  ]
  const tenantIds = [
    ...new Set(rows.filter((r) => r.subjectType === 'tenant').map((r) => r.subjectId)),
  ]

  const [staff, tenants, facilities] = await Promise.all([
    prisma.staffUser.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, firstName: true, lastName: true },
    }),
    tenantIds.length > 0
      ? prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [],
    subjectFacilities(rows.map((r) => ({ type: r.subjectType, id: r.subjectId }))),
  ])

  const staffNames = new Map(staff.map((s) => [s.id, fullName(s)]))
  const tenantNames = new Map(tenants.map((t) => [t.id, fullName(t)]))

  return rows.map((row) => ({
    id: row.id,
    impersonatorStaffId: row.impersonatorStaffId,
    // A deleted-or-renamed party degrades to the id rather than to an empty
    // cell: an oversight record naming nobody is worse than one naming a key.
    impersonatorName: staffNames.get(row.impersonatorStaffId) ?? row.impersonatorStaffId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectName:
      (row.subjectType === 'staff'
        ? staffNames.get(row.subjectId)
        : tenantNames.get(row.subjectId)) ?? row.subjectId,
    facilityIds: facilities.get(`${row.subjectType}:${row.subjectId}`) ?? [],
    reason: row.reason,
    ticketRef: row.ticketRef,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    endedAt: row.endedAt,
    endedBy: row.endedBy,
    endedByName: row.endedByStaffId ? (staffNames.get(row.endedByStaffId) ?? row.endedByStaffId) : null,
  }))
}

const SELECT = {
  id: true,
  impersonatorStaffId: true,
  subjectType: true,
  subjectId: true,
  reason: true,
  ticketRef: true,
  startedAt: true,
  expiresAt: true,
  endedAt: true,
  endedBy: true,
  endedByStaffId: true,
} as const

/// FR-18. Sessions that are running RIGHT NOW.
///
/// **Two conditions, and the second is the one a later reader will drop.**
/// B-091 enforces expiry lazily: `endedAt` is stamped the first time anybody
/// touches the row, so a session whose impersonator closed their laptop is
/// unexpired on paper and expired in fact. Filtering on `endedAt IS NULL` alone
/// would list it as active and offer a force-end button that ends nothing.
/// Part 1 wrote this down as "a query, not a column"; this is the query.
export async function activeSessions(actor: Actor, now: Date = new Date()): Promise<SessionRow[]> {
  const rows = await prisma.impersonationSession.findMany({
    where: { endedAt: null, expiresAt: { gt: now } },
    orderBy: { startedAt: 'desc' },
    select: SELECT,
  })
  return scoped(actor, await decorate(rows))
}

export type ReportFilters = {
  from: Date
  /// Exclusive, matching `reportRange`.
  to: Date
  impersonatorStaffId?: string
  subjectQuery?: string
  facilityId?: string
}

/// FR-19. The record, filterable by impersonator, subject, date and facility.
///
/// PRD 09 names PRD 02 US-38's audit-log surface as the thing to mirror. **That
/// surface does not exist** — `findAuditEntries` has been in the codebase since
/// B-005 with no consumer outside tests — so this follows the `/admin/reports`
/// convention instead: filters live in the query string, and the `.csv` sibling
/// route re-reads the same string through the same function, which is the only
/// way US-39's "export matching on-screen data exactly" can be true.
export async function sessionReport(
  actor: Actor,
  filters: ReportFilters,
): Promise<SessionRow[]> {
  const rows = await prisma.impersonationSession.findMany({
    where: {
      startedAt: { gte: filters.from, lt: filters.to },
      ...(filters.impersonatorStaffId
        ? { impersonatorStaffId: filters.impersonatorStaffId }
        : {}),
    },
    orderBy: { startedAt: 'desc' },
    select: SELECT,
  })

  let decorated = scoped(actor, await decorate(rows))

  if (filters.facilityId) {
    const wanted = filters.facilityId
    decorated = decorated.filter((row) => row.facilityIds.includes(wanted))
  }
  if (filters.subjectQuery) {
    // Matched on the resolved NAME rather than in SQL, because the subject is
    // polymorphic: `subjectId` points at a tenant or a staff user depending on
    // the row, so there is no column to join and searching one table would
    // silently return half the answers.
    const needle = filters.subjectQuery.trim().toLowerCase()
    if (needle) decorated = decorated.filter((row) => row.subjectName.toLowerCase().includes(needle))
  }
  return decorated
}

/// Never wider than `facilityAccess()`, the same fail-closed contract every
/// other facility-scoped read in this app takes.
///
/// Owner-only at seed (D-13b) means this is a no-op today — an all-facilities
/// actor sees everything. It is here so that §4's promise holds: widening
/// `impersonation:oversee` to a `regional` is a seed change, and a regional must
/// then see the sessions that touched THEIR sites and no others. A session whose
/// subject reaches no facility at all is visible only to an all-facilities
/// actor, matching how the escalation guard already refuses to confine one.
function scoped(actor: Actor, rows: SessionRow[]): SessionRow[] {
  const access = facilityAccess(actor)
  if (access.all) return rows
  return rows.filter((row) => row.facilityIds.some((id) => access.facilityIds.includes(id)))
}

export type FrequencyFlag = {
  impersonatorStaffId: string
  impersonatorName: string
  /// The UTC day, as `yyyy-mm-dd`.
  day: string
  distinctSubjects: number
}

/// FR-20. Who reached more than the threshold of DISTINCT subjects in one day.
///
/// Distinct subjects rather than session count on purpose: five sessions
/// against one tenant across a morning is somebody debugging one problem, which
/// is the feature working. Five different tenants is a pattern, and it is the
/// pattern the flag is looking for.
///
/// Computed from the rows the caller already has, so the flag can never
/// disagree with the table above it — and so a filtered report flags what is on
/// screen rather than something the reader cannot see.
export function frequencyFlags(
  rows: readonly SessionRow[],
  threshold: number = FREQUENCY_FLAG_DISTINCT_SUBJECTS,
): FrequencyFlag[] {
  const byDay = new Map<string, { name: string; subjects: Set<string> }>()

  for (const row of rows) {
    const day = row.startedAt.toISOString().slice(0, 10)
    const key = `${row.impersonatorStaffId}|${day}`
    const entry = byDay.get(key)
    if (entry) entry.subjects.add(`${row.subjectType}:${row.subjectId}`)
    else {
      byDay.set(key, {
        name: row.impersonatorName,
        subjects: new Set([`${row.subjectType}:${row.subjectId}`]),
      })
    }
  }

  return [...byDay.entries()]
    .filter(([, entry]) => entry.subjects.size > threshold)
    .map(([key, entry]) => {
      const [impersonatorStaffId, day] = key.split('|')
      return {
        impersonatorStaffId,
        impersonatorName: entry.name,
        day,
        distinctSubjects: entry.subjects.size,
      }
    })
    .sort((a, b) => b.distinctSubjects - a.distinctSubjects || a.day.localeCompare(b.day))
}
