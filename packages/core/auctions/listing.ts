// PRD 02 §4.6 US-30 (B-129). Which scheduled sales may be advertised, and the
// reason for every one that may not.
//
// ── What this is, and deliberately is not ───────────────────────────────────
//
// It is NOT a marketplace driver. Master PRD §11 OQ-9 — live on-site auctions
// versus online — has never been answered, and D-63 refuses to answer it by
// building for it; a StorageTreasures-class listing also needs a partner
// agreement, so there is no published spec to write against. What is built
// here is the half that is useful whichever way OQ-9 goes: a structured lot
// sheet an operator uploads to a marketplace, hands to an auctioneer, or reads
// out to a newspaper. It fabricates nothing. No `AuctionAdvertisement` row is
// written by exporting — a row on that table is a claim that an advertisement
// RAN, and it is still typed by the person who placed it (B-062).
//
// ── Why the selection rule is the whole point ───────────────────────────────
//
// "An advertisement that never ran is the commonest wrongful-sale claim after
// an unserved notice" — and its mirror image is an advertisement that ran for a
// sale that could not lawfully happen. A lot goes onto a marketplace days
// before the sale, and in between the tenant may pay, a bankruptcy or SCRA hold
// may land, or somebody may record that the unit holds a titled vehicle. Every
// one of those makes the advertisement wrong, and none of them makes the CSV
// somebody already downloaded wrong — which is why the refusal is computed at
// export time, on the same `auctionReadiness` the case screen refuses on,
// rather than being a filter on `status`.
//
// A case is exportable only if all three hold. `status === 'scheduled'` alone
// is not enough: it records that a sale WAS scheduled, not that it may still
// proceed.
import type { Readiness } from './readiness.ts'

export type LotCandidate = {
  caseId: string
  unitNumber: string
  status: 'eligible' | 'scheduled' | 'sold' | 'cancelled'
  scheduledSaleDate: Date | null
  readiness: Readiness
}

/// Named rather than free text so the screen can group and the tests can assert
/// on something other than a sentence.
export type LotRefusalKind = 'not_scheduled' | 'no_sale_date' | 'not_ready' | 'no_unit_type'

export type LotRefusal = {
  caseId: string
  unitNumber: string
  kind: LotRefusalKind
  /// What to tell the operator. For `not_ready` this is every blocker, not the
  /// first — the same reasoning `auctionReadiness` gives for listing them all.
  reason: string
}

export type LotSelection<T extends LotCandidate> = {
  lots: T[]
  refused: LotRefusal[]
}

/// Split scheduled cases into what may be advertised and what may not.
///
/// Generic in the row type so a caller can carry the address, size and terms
/// alongside without this module knowing about any of them — the rule here is
/// only about whether a sale may be advertised at all.
/// Attach each lot's size, refusing — by name — any the lookup cannot size.
///
/// B-205. This was a `flatMap ... return []` inside the database function: a
/// listable lot whose unit had no type vanished from the sheet and appeared in
/// neither list. The state cannot arise through the schema, which is why it was
/// written that way and why it is here now rather than in a database test —
/// the rule it broke is this module's own, that every dropped case is named
/// with its reason, and a short file nobody realises is short is the whole
/// failure mode the refusal list exists to prevent.
export function withUnitSizes<T extends { caseId: string; unitNumber: string; unitId: string }, S>(
  lots: readonly T[],
  sizeOf: (unitId: string) => S | undefined,
): { sized: (T & { size: S })[]; refused: LotRefusal[] } {
  const sized: (T & { size: S })[] = []
  const refused: LotRefusal[] = []
  for (const lot of lots) {
    const size = sizeOf(lot.unitId)
    if (size === undefined) {
      refused.push({
        caseId: lot.caseId,
        unitNumber: lot.unitNumber,
        kind: 'no_unit_type',
        reason:
          'This unit has no size on record, so the sheet cannot state the dimensions a buyer bids on. Set the unit type before advertising.',
      })
      continue
    }
    sized.push({ ...lot, size })
  }
  return { sized, refused }
}

export function selectListableLots<T extends LotCandidate>(cases: readonly T[]): LotSelection<T> {
  const lots: T[] = []
  const refused: LotRefusal[] = []

  for (const one of cases) {
    const at = { caseId: one.caseId, unitNumber: one.unitNumber }

    // Sold and cancelled cases are not "not yet scheduled" in any useful sense,
    // but they are also not something anybody is about to advertise, so they
    // are simply not candidates. Only a case somebody might reasonably expect
    // to see on the sheet earns a refusal line.
    if (one.status === 'sold' || one.status === 'cancelled') continue

    if (one.status !== 'scheduled') {
      refused.push({
        ...at,
        kind: 'not_scheduled',
        reason: 'No sale has been scheduled yet, so there is no date to advertise.',
      })
      continue
    }

    if (!one.scheduledSaleDate) {
      // Belt and braces: `scheduleSale` cannot produce this, and a lot sheet
      // with a blank sale date is exactly the document that gets a sale
      // challenged, so it is refused rather than exported with an empty column.
      refused.push({
        ...at,
        kind: 'no_sale_date',
        reason: 'This case is scheduled but carries no sale date.',
      })
      continue
    }

    if (!one.readiness.ready) {
      refused.push({
        ...at,
        kind: 'not_ready',
        reason: one.readiness.blockers.map((blocker) => blocker.message).join(' '),
      })
      continue
    }

    lots.push(one)
  }

  return { lots, refused }
}
