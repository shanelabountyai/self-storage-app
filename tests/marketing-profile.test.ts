import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_THRESHOLD,
  GBP_CHECKLIST,
  GBP_STALE_DAYS,
  descriptionAdvice,
  facilityReadiness,
  findDuplicates,
  gbpIsStale,
  gbpWebsiteUrl,
  similarity,
  titleAdvice,
} from '../packages/core/marketing/profile'

// B-067 / PRD 04 US-2 AC3, US-5.

describe('character guidance — US-2 AC3', () => {
  it('says nothing about a title that fits', () => {
    expect(titleAdvice('Austin — South Congress | Storage Units in Austin, TX').status).toBe('ok')
  })

  it('warns rather than blocks a title that runs long', () => {
    // A marketer who wants 70 characters has a reason; refusing them would just
    // move the copy into a spreadsheet.
    const advice = titleAdvice('x'.repeat(70))
    expect(advice.status).toBe('long')
    expect(advice.message).toContain('cut off')
  })

  it('calls a 300-character title what it is', () => {
    const advice = titleAdvice('x'.repeat(300))
    expect(advice.status).toBe('too_long')
    expect(advice.message).toContain('paste')
  })

  it('says nothing at all about an empty field', () => {
    // Empty means "use the generated default", which is a valid choice and not
    // something to nag about.
    expect(titleAdvice('').message).toBeNull()
    expect(descriptionAdvice('   ').message).toBeNull()
  })

  it('holds descriptions to their own limit', () => {
    expect(descriptionAdvice('x'.repeat(150)).status).toBe('ok')
    expect(descriptionAdvice('x'.repeat(180)).status).toBe('long')
    expect(descriptionAdvice('x'.repeat(400)).status).toBe('too_long')
  })
})

describe('duplicate detection — US-2 AC3', () => {
  const austin =
    'Self-storage units from $59/mo at Austin — South Congress in Austin, TX. Compare sizes, see gate hours, and rent online in minutes.'

  it('catches the real case: pasted and city-swapped', () => {
    const dallas = austin.replace(/Austin/g, 'Dallas')
    expect(similarity(austin, dallas)).toBeGreaterThan(DUPLICATE_THRESHOLD)
  })

  it('does not fire on two genuinely different descriptions', () => {
    const other =
      'Drive-up storage beside the airport with 24-hour gate access, a resident manager, and covered loading bays for box trucks.'
    expect(similarity(austin, other)).toBeLessThan(DUPLICATE_THRESHOLD)
  })

  it('scores an exact match as one', () => {
    expect(similarity(austin, austin)).toBe(1)
  })

  it('reports the worst offender first', () => {
    const warnings = findDuplicates(austin, [
      { name: 'Barely related', metaDescription: 'Boat and RV parking on a gravel lot.' },
      { name: 'Dallas', metaDescription: austin.replace(/Austin/g, 'Dallas') },
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].facilityName).toBe('Dallas')
  })

  it('ignores facilities with no description of their own', () => {
    expect(findDuplicates(austin, [{ name: 'Empty', metaDescription: null }])).toEqual([])
  })

  it('says nothing when there is nothing to compare', () => {
    expect(findDuplicates('', [{ name: 'X', metaDescription: austin }])).toEqual([])
  })
})

describe('facilityReadiness — the launch gate', () => {
  const ready = {
    photos: [
      { kind: 'exterior', alt: 'The front gate from the road' },
      { kind: 'gate', alt: 'Keypad' },
      { kind: 'hallway', alt: 'Interior corridor' },
      { kind: 'unit', alt: 'A 10x10 with the door open' },
      { kind: 'security', alt: 'Camera over the entrance' },
    ],
    seoTitle: 'A title',
    metaDescription: 'A description',
    longDescription: 'Some real copy about this location.',
    faqCount: 5,
    hasGateHours: true,
    hasPhone: true,
  }

  it('passes a fully prepared facility', () => {
    expect(facilityReadiness(ready).every((check) => check.ok)).toBe(true)
  })

  it('fails the exterior-photo gate specifically', () => {
    // The backlog's own gate: "at least one exterior photo per active facility".
    const checks = facilityReadiness({
      ...ready,
      photos: ready.photos.filter((photo) => photo.kind !== 'exterior'),
    })
    const gate = checks.find((check) => check.key === 'exterior_photo')!
    expect(gate.ok).toBe(false)
    expect(gate.fix).toContain('front of the site')
  })

  it('catches whitespace typed to get past the alt-text field', () => {
    const checks = facilityReadiness({
      ...ready,
      photos: [...ready.photos, { kind: 'other', alt: '   ' }],
    })
    expect(checks.find((check) => check.key === 'photo_alt')!.ok).toBe(false)
  })

  it('counts photos and FAQs honestly in the fix text', () => {
    const checks = facilityReadiness({ ...ready, photos: ready.photos.slice(0, 2), faqCount: 1 })
    expect(checks.find((check) => check.key === 'five_photos')!.fix).toContain('2 so far')
    expect(checks.find((check) => check.key === 'faqs')!.fix).toContain('1 written')
  })

  it('flags a page with no long-form copy', () => {
    const checks = facilityReadiness({ ...ready, longDescription: '  ' })
    expect(checks.find((check) => check.key === 'unique_description')!.ok).toBe(false)
  })

  it('gives every check a label and a fix when it fails', () => {
    const bare = facilityReadiness({
      photos: [],
      seoTitle: null,
      metaDescription: null,
      longDescription: null,
      faqCount: 0,
      hasGateHours: false,
      hasPhone: false,
    })

    for (const check of bare) {
      expect(check.label).toBeTruthy()
      expect(check.fix).toBeTruthy()
    }

    // Everything fails on a bare facility EXCEPT the alt-text check, which
    // passes vacuously: there are no photos, so none of them is missing alt
    // text. Left as-is rather than given a third state — `exterior_photo` and
    // `five_photos` both fail right beside it, so nobody reads "every photo has
    // alt text" on a facility with no photos as a claim that it has any.
    expect(bare.filter((check) => check.ok).map((check) => check.key)).toEqual(['photo_alt'])
  })
})

describe('GBP checklist — US-5', () => {
  it('covers every item AC1 names', () => {
    const keys = GBP_CHECKLIST.map((item) => item.key)
    expect(keys).toEqual(['nap', 'hours', 'website', 'photos', 'category', 'posts'])
  })

  it('treats never-verified as stale', () => {
    expect(gbpIsStale(null)).toBe(true)
  })

  it('goes stale after 90 days — AC2', () => {
    const now = new Date('2026-08-07T00:00:00Z')
    const fresh = new Date(now.getTime() - (GBP_STALE_DAYS - 1) * 86_400_000)
    const old = new Date(now.getTime() - (GBP_STALE_DAYS + 1) * 86_400_000)
    expect(gbpIsStale(fresh, now)).toBe(false)
    expect(gbpIsStale(old, now)).toBe(true)
  })

  it('tags the website link so a GBP click is attributable', () => {
    expect(gbpWebsiteUrl('https://example.com/storage/tx/austin/south')).toBe(
      'https://example.com/storage/tx/austin/south?utm_source=google&utm_medium=organic_gbp',
    )
  })

  it('appends rather than clobbering an existing query', () => {
    expect(gbpWebsiteUrl('https://example.com/x?a=1')).toContain('?a=1&utm_source=google')
  })
})
