import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { createReview, reviewsForFacility, setReviewVisibility } from '../apps/web/lib/admin/reviews'
import { visibleReviewsForFacility } from '../apps/web/lib/reviews/public'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-071 / PRD 04 §3.4 FR-REV-1/FR-REV-2, US-6, against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['facility:settings']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('reviews', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Reviews ${suffix}`,
        slug: `reviews-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `review-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
  })

  beforeEach(async () => {
    await prisma.review.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.review.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('creates a review and refuses an invalid one', async () => {
    const result = await createReview(actor(), facilityId, {
      rating: 5,
      text: 'Clean, friendly staff.',
      reviewerDisplayName: 'John D.',
      reviewDate: new Date('2026-06-01T00:00:00Z'),
      source: 'manual_google',
    })
    expect(result.ok).toBe(true)

    const bad = await createReview(actor(), facilityId, {
      rating: 9,
      text: '',
      reviewerDisplayName: '',
      reviewDate: new Date('2026-06-01T00:00:00Z'),
      source: 'manual_google',
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('unreachable')
    expect(bad.problems.length).toBeGreaterThan(1)
  })

  it('lists every review to admins, visible or not', async () => {
    await createReview(actor(), facilityId, {
      rating: 5,
      text: 'Great.',
      reviewerDisplayName: 'A.',
      reviewDate: new Date('2026-06-01T00:00:00Z'),
      source: 'manual_google',
    })
    const created = await createReview(actor(), facilityId, {
      rating: 1,
      text: 'Not great.',
      reviewerDisplayName: 'B.',
      reviewDate: new Date('2026-06-02T00:00:00Z'),
      source: 'manual_other',
    })
    if (!created.ok) throw new Error('unreachable')
    await setReviewVisibility(actor(), created.id, false)

    const rows = await reviewsForFacility(actor(), facilityId)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === created.id)?.visible).toBe(false)
  })

  describe('setReviewVisibility — FR-REV-2 "hide, not edit"', () => {
    it('toggles visibility and audits the change', async () => {
      const created = await createReview(actor(), facilityId, {
        rating: 4,
        text: 'Original text, never to change.',
        reviewerDisplayName: 'C.',
        reviewDate: new Date('2026-06-01T00:00:00Z'),
        source: 'manual_google',
      })
      if (!created.ok) throw new Error('unreachable')

      await setReviewVisibility(actor(), created.id, false)
      const hidden = await prisma.review.findUniqueOrThrow({ where: { id: created.id } })
      expect(hidden.visible).toBe(false)
      expect(hidden.text).toBe('Original text, never to change.')

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'review.visibility_changed', entityId: created.id },
      })
      expect((entry.after as Record<string, unknown>).visible).toBe(false)
    })

    it('does nothing, and audits nothing, when already at that visibility', async () => {
      const created = await createReview(actor(), facilityId, {
        rating: 4,
        text: 'Fine.',
        reviewerDisplayName: 'D.',
        reviewDate: new Date('2026-06-01T00:00:00Z'),
        source: 'manual_google',
      })
      if (!created.ok) throw new Error('unreachable')

      await setReviewVisibility(actor(), created.id, true)
      expect(
        await prisma.auditLog.count({ where: { action: 'review.visibility_changed', entityId: created.id } }),
      ).toBe(0)
    })
  })

  describe('visibleReviewsForFacility — the public read (US-6)', () => {
    it('excludes hidden reviews from the list AND the average', async () => {
      await createReview(actor(), facilityId, {
        rating: 5,
        text: 'Loved it.',
        reviewerDisplayName: 'E.',
        reviewDate: new Date('2026-06-01T00:00:00Z'),
        source: 'manual_google',
      })
      const hidden = await createReview(actor(), facilityId, {
        rating: 1,
        text: 'Should not count.',
        reviewerDisplayName: 'F.',
        reviewDate: new Date('2026-06-02T00:00:00Z'),
        source: 'manual_google',
      })
      if (!hidden.ok) throw new Error('unreachable')
      await setReviewVisibility(actor(), hidden.id, false)

      const result = await visibleReviewsForFacility(facilityId)
      expect(result.reviews).toHaveLength(1)
      expect(result.average).toEqual({ ratingValue: 5, reviewCount: 1 })
    })

    it('orders newest-reviewed first and respects the limit', async () => {
      for (const [date, name] of [
        ['2026-05-01', 'Old'],
        ['2026-07-01', 'New'],
        ['2026-06-01', 'Mid'],
      ] as const) {
        await createReview(actor(), facilityId, {
          rating: 5,
          text: 'x',
          reviewerDisplayName: name,
          reviewDate: new Date(`${date}T00:00:00Z`),
          source: 'manual_google',
        })
      }

      const result = await visibleReviewsForFacility(facilityId, 2)
      expect(result.reviews.map((r) => r.reviewerDisplayName)).toEqual(['New', 'Mid'])
      // The average still reflects all three, even though only 2 render.
      expect(result.average?.reviewCount).toBe(3)
    })

    it('NEVER supplies schemaAggregateRating for manual sources — D-33', async () => {
      await createReview(actor(), facilityId, {
        rating: 5,
        text: 'x',
        reviewerDisplayName: 'G.',
        reviewDate: new Date('2026-06-01T00:00:00Z'),
        source: 'manual_google',
      })
      const result = await visibleReviewsForFacility(facilityId)
      expect(result.average).not.toBeNull()
      expect(result.schemaAggregateRating).toBeNull()
    })

    it('returns nothing for a facility with no reviews', async () => {
      const result = await visibleReviewsForFacility(facilityId)
      expect(result.average).toBeNull()
      expect(result.reviews).toEqual([])
      expect(result.schemaAggregateRating).toBeNull()
    })
  })
})
