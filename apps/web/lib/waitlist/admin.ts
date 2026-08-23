import { prisma } from '@storage/db'
import { CLAIM_WINDOW_HOURS } from '@storage/core/waitlist'

// PRD 01 §9 Phase 3 (B-090 part 1). What the waitlist looks like to an operator.
//
// This is not a courtesy screen. A waitlist is the only demand signal this
// product has for inventory it does NOT have — "nine people want a 10×20 in
// Austin" is the number behind a rate rise, a conversion, or a decision to
// build, and it exists nowhere else. B-088 part 1's street-rate suggestions
// read occupancy, which can only ever say a site is full; this says how full.

export type WaitlistContact = {
  id: string
  name: string | null
  email: string
  phone: string | null
  status: 'waiting' | 'notified'
  since: Date
}

export type WaitlistDemandRow = {
  unitTypeId: string
  unitTypeName: string
  widthFt: number
  lengthFt: number
  /// People still waiting. The demand number.
  waiting: number
  /// Notified and inside their claim window — a unit is free and somebody has
  /// been told. Shown separately because it is work in progress, not demand.
  claiming: number
  /// Units of this size free right now. Zero is the normal state for a size
  /// with a waitlist; anything else means the sweep is mid-flight or every
  /// claim has expired.
  availableNow: number
  /// When the longest-waiting person joined. Null when nobody is waiting.
  waitingSince: Date | null
  /// B-154: this report used to render demand with none of the contact
  /// details the row already holds, which made it a list of people who wanted
  /// to give us money. Oldest first, matching `waitingSince`.
  contacts: WaitlistContact[]
}

/// One facility's waitlist, by unit type, longest queue first.
export async function waitlistDemand(facilityId: string): Promise<WaitlistDemandRow[]> {
  const entries = await prisma.waitlistEntry.findMany({
    where: { facilityId, status: { in: ['waiting', 'notified'] } },
    select: {
      id: true,
      unitTypeId: true,
      status: true,
      createdAt: true,
      firstName: true,
      email: true,
      phone: true,
      unitType: { select: { name: true, widthFt: true, lengthFt: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  if (entries.length === 0) return []

  const unitTypeIds = [...new Set(entries.map((entry) => entry.unitTypeId))]
  const availability = await prisma.unit.groupBy({
    by: ['unitTypeId'],
    where: { unitTypeId: { in: unitTypeIds }, status: 'available' },
    _count: { _all: true },
  })
  const availableBy = new Map(availability.map((row) => [row.unitTypeId, row._count._all]))

  const rows = new Map<string, WaitlistDemandRow>()
  for (const entry of entries) {
    let row = rows.get(entry.unitTypeId)
    if (!row) {
      row = {
        unitTypeId: entry.unitTypeId,
        unitTypeName: entry.unitType.name,
        widthFt: entry.unitType.widthFt,
        lengthFt: entry.unitType.lengthFt,
        waiting: 0,
        claiming: 0,
        availableNow: availableBy.get(entry.unitTypeId) ?? 0,
        waitingSince: null,
        contacts: [],
      }
      rows.set(entry.unitTypeId, row)
    }
    if (entry.status === 'waiting') {
      row.waiting += 1
      // Entries arrive oldest-first, so the first `waiting` one seen is the
      // longest-waiting.
      row.waitingSince ??= entry.createdAt
    } else {
      row.claiming += 1
    }
    row.contacts.push({
      id: entry.id,
      name: entry.firstName,
      email: entry.email,
      phone: entry.phone,
      status: entry.status as 'waiting' | 'notified',
      since: entry.createdAt,
    })
  }

  return [...rows.values()].sort(
    (a, b) => b.waiting - a.waiting || a.widthFt * a.lengthFt - b.widthFt * b.lengthFt,
  )
}

export const WAITLIST_CLAIM_WINDOW_HOURS = CLAIM_WINDOW_HOURS
