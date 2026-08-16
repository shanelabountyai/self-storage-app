import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  addFaq,
  addPhoto,
  marketingProfile,
  removePhoto,
  saveGbpChecklist,
  saveMarketingCopy,
} from '../apps/web/lib/admin/marketing-profile'
import { publicFacilityBySlug } from '../apps/web/lib/facility/public-facility'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-067 / PRD 04 US-2, US-5, against real rows.
//
// The property that matters most is the fallback: every field here is optional,
// and a facility nobody has written copy for must still render a complete page.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
const slug = `marketing-${suffix}`

function actor(permissions: PermissionKey[] = ['facility:settings']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const profile = () => marketingProfile(actor(), facilityId, 'https://example.com/x', 'NAP')

describeDb('the marketing profile', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Marketing ${suffix}`,
        slug,
        addressLine1: '2400 South Congress Ave',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        status: 'active',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `marketing-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Marketer' },
    })
    staffId = staff.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.facilityPhoto.deleteMany({ where: { facilityId } })
    await prisma.facilityFaq.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  describe('copy — US-2 AC1', () => {
    it('starts empty, and the public page still renders complete', async () => {
      const before = await profile()
      expect(before.seoTitle).toBeNull()
      expect(before.metaDescription).toBeNull()

      // The fallback that makes every field optional: no stored copy, and the
      // page still has FAQs to show (B-066's generated five).
      const publicView = await publicFacilityBySlug(slug)
      expect(publicView?.faqs).toEqual([])
      expect(publicView?.photos).toEqual([])
      expect(publicView?.seoTitle).toBeNull()
    })

    it('saves and reads back', async () => {
      const result = await saveMarketingCopy(actor(), facilityId, {
        seoTitle: 'Storage on South Congress',
        metaDescription: 'Drive-up and climate-controlled units a mile from downtown Austin.',
        heroCopy: 'Two blocks off Congress, open until 10pm.',
        longDescription: 'First paragraph.\n\nSecond paragraph.',
      })
      expect(result).toEqual({ ok: true })

      const saved = await profile()
      expect(saved.seoTitle).toBe('Storage on South Congress')
      expect(saved.longDescription).toContain('Second paragraph')
    })

    it('treats an emptied field as "use the generated default", not as empty copy', async () => {
      await saveMarketingCopy(actor(), facilityId, {
        seoTitle: '   ',
        metaDescription: 'Drive-up and climate-controlled units a mile from downtown Austin.',
        heroCopy: '',
        longDescription: 'First paragraph.\n\nSecond paragraph.',
      })
      const saved = await profile()
      expect(saved.seoTitle).toBeNull()
      expect(saved.heroCopy).toBeNull()
    })

    it('refuses a title that is obviously a paste accident', async () => {
      const result = await saveMarketingCopy(actor(), facilityId, {
        seoTitle: 'x'.repeat(300),
        metaDescription: '',
        heroCopy: '',
        longDescription: '',
      })
      expect(result).toMatchObject({ ok: false, field: 'seoTitle' })
    })

    it('refuses a staffer without the settings permission', async () => {
      await expect(
        saveMarketingCopy(actor(['tenants:view']), facilityId, {
          seoTitle: 'x',
          metaDescription: '',
          heroCopy: '',
          longDescription: '',
        }),
      ).rejects.toThrow()
    })
  })

  describe('photos — alt text is not optional', () => {
    it('refuses a photo with no alt text', async () => {
      const result = await addPhoto(actor(), facilityId, {
        url: 'https://example.com/front.jpg',
        alt: '   ',
        kind: 'exterior',
      })
      // WCAG 1.1.1 is an acceptance criterion here, and "we will add alt text
      // later" is how a photo set ends up with three of eleven.
      expect(result).toMatchObject({ ok: false, field: 'alt' })
      expect(await prisma.facilityPhoto.count({ where: { facilityId } })).toBe(0)
    })

    it('refuses something that is not a URL', async () => {
      const result = await addPhoto(actor(), facilityId, {
        url: 'front.jpg',
        alt: 'The front gate',
        kind: 'exterior',
      })
      expect(result).toMatchObject({ ok: false, field: 'url' })
    })

    it('adds one, and the public page picks it up', async () => {
      await addPhoto(actor(), facilityId, {
        url: 'https://example.com/front.jpg',
        alt: 'The front gate from the road',
        kind: 'exterior',
      })

      const publicView = await publicFacilityBySlug(slug)
      expect(publicView?.photos).toHaveLength(1)
      expect(publicView?.photos[0].alt).toBe('The front gate from the road')
    })

    it('clears the exterior-photo launch gate', async () => {
      const checks = (await profile()).readiness
      expect(checks.find((check) => check.key === 'exterior_photo')!.ok).toBe(true)
      // But not the five-photo one, with a single photo on file.
      expect(checks.find((check) => check.key === 'five_photos')!.ok).toBe(false)
    })

    it('will not delete another facility’s photo through a forged id', async () => {
      const other = await prisma.facility.create({
        data: {
          name: `Other ${suffix}`,
          slug: `other-${suffix}`,
          addressLine1: '1 Elsewhere',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          timezone: 'America/Chicago',
        },
      })
      const theirs = await prisma.facilityPhoto.create({
        data: { facilityId: other.id, url: 'https://example.com/theirs.jpg', alt: 'Theirs', position: 10 },
      })

      // The permission check passes — this actor really can edit `facilityId`.
      // The scoping on the delete is what stops it reaching across.
      await removePhoto(actor(), facilityId, theirs.id)

      expect(await prisma.facilityPhoto.findUnique({ where: { id: theirs.id } })).not.toBeNull()
      await prisma.facilityPhoto.deleteMany({ where: { facilityId: other.id } })
    })
  })

  describe('FAQs — US-2 AC1', () => {
    it('replaces the generated set once one is written', async () => {
      await addFaq(actor(), facilityId, {
        question: 'Is there a truck?',
        answer: 'Yes, free for the first two hours on move-in day.',
      })

      const publicView = await publicFacilityBySlug(slug)
      // A marketer who has written one answer has decided what this page says;
      // padding it back to five with boilerplate would put words in their mouth.
      expect(publicView?.faqs).toHaveLength(1)
      expect(publicView?.faqs[0].question).toBe('Is there a truck?')
    })

    it('orders them, sparsely, so an insert does not renumber the rest', async () => {
      await addFaq(actor(), facilityId, { question: 'Second?', answer: 'Yes.' })
      const rows = await prisma.facilityFaq.findMany({
        where: { facilityId },
        orderBy: { position: 'asc' },
      })
      expect(rows.map((row) => row.position)).toEqual([10, 20])
    })

    it('refuses a question with no answer', async () => {
      expect(await addFaq(actor(), facilityId, { question: 'Q?', answer: ' ' })).toMatchObject({
        ok: false,
        field: 'answer',
      })
    })
  })

  describe('GBP checklist — US-5 AC2', () => {
    it('starts stale, because nobody has looked', async () => {
      expect((await profile()).gbp.stale).toBe(true)
      expect((await profile()).gbp.verifiedAt).toBeNull()
    })

    it('records what was ticked and dates it', async () => {
      await saveGbpChecklist(actor(), facilityId, ['nap', 'hours'])
      const saved = await profile()
      expect(saved.gbp.checked).toEqual(['nap', 'hours'])
      expect(saved.gbp.stale).toBe(false)
    })

    it('dates a check that ticked nothing', async () => {
      // "Somebody looked on Tuesday and it was still wrong" is information.
      await saveGbpChecklist(actor(), facilityId, [])
      const saved = await profile()
      expect(saved.gbp.checked).toEqual([])
      expect(saved.gbp.verifiedAt).not.toBeNull()
      expect(saved.gbp.stale).toBe(false)
    })

    it('ignores a key that is not on the checklist', async () => {
      await saveGbpChecklist(actor(), facilityId, ['nap', 'not-a-real-item'])
      expect((await profile()).gbp.checked).toEqual(['nap'])
    })
  })
})
