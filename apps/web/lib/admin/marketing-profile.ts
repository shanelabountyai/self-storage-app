import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  DESCRIPTION_HARD_MAX,
  TITLE_HARD_MAX,
  facilityReadiness,
  findDuplicates,
  gbpIsStale,
  GBP_CHECKLIST,
  type DuplicateWarning,
  type ReadinessCheck,
} from '@storage/core/marketing'
import { parseWeeklySchedule } from '@storage/core/facility-settings'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 04 US-2, US-5 (B-067). Editing the unique content blocks of a location
// page without a deploy.
//
// Every field here is nullable and every one falls back to B-066's generated
// default. That is the design rather than a convenience: a facility nobody has
// written copy for still gets a title, a description and five true FAQs, so
// "the marketer has not got to this site yet" never means "this page is
// broken".

export type FacilityPhotoRow = {
  id: string
  url: string
  alt: string
  kind: string
  position: number
}

export type FacilityFaqRow = {
  id: string
  question: string
  answer: string
  position: number
}

export type MarketingProfile = {
  facilityId: string
  facilityName: string
  seoTitle: string | null
  metaDescription: string | null
  heroCopy: string | null
  longDescription: string | null
  photos: FacilityPhotoRow[]
  faqs: FacilityFaqRow[]
  /// US-2 AC3's warning, computed against every OTHER facility's description.
  duplicates: DuplicateWarning[]
  readiness: ReadinessCheck[]
  gbp: {
    verifiedAt: Date | null
    stale: boolean
    checked: string[]
    /// The NAP block, byte-identical to what the page renders, for AC3's
    /// copy-paste.
    napBlock: string
    websiteUrl: string
  }
}

export async function marketingProfile(
  actor: Actor,
  facilityId: string,
  facilityUrl: string,
  napBlock: string,
): Promise<MarketingProfile> {
  requirePermission(actor, 'facility:settings', facilityId)

  const [facility, photos, faqs, others] = await Promise.all([
    prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: {
        name: true,
        phone: true,
        gateHours: true,
        seoTitle: true,
        metaDescription: true,
        heroCopy: true,
        longDescription: true,
        gbpVerifiedAt: true,
        gbpCheckedItems: true,
      },
    }),
    prisma.facilityPhoto.findMany({ where: { facilityId }, orderBy: { position: 'asc' } }),
    prisma.facilityFaq.findMany({ where: { facilityId }, orderBy: { position: 'asc' } }),
    // Every other facility, for the duplicate check. Not scoped to what this
    // actor can see: a duplicate description is a duplicate whether or not the
    // person editing has access to the other site, and hiding the collision
    // would let two facilities they cannot both see quietly cannibalise each
    // other. Only the name is exposed, which they would learn from the warning
    // anyway.
    prisma.facility.findMany({
      where: { id: { not: facilityId } },
      select: { name: true, metaDescription: true },
    }),
  ])

  return {
    facilityId,
    facilityName: facility.name,
    seoTitle: facility.seoTitle,
    metaDescription: facility.metaDescription,
    heroCopy: facility.heroCopy,
    longDescription: facility.longDescription,
    photos,
    faqs,
    duplicates: findDuplicates(facility.metaDescription ?? '', others),
    readiness: facilityReadiness({
      photos,
      seoTitle: facility.seoTitle,
      metaDescription: facility.metaDescription,
      longDescription: facility.longDescription,
      faqCount: faqs.length,
      hasGateHours: parseWeeklySchedule(facility.gateHours) !== null,
      hasPhone: Boolean(facility.phone),
    }),
    gbp: {
      verifiedAt: facility.gbpVerifiedAt,
      stale: gbpIsStale(facility.gbpVerifiedAt),
      checked: facility.gbpCheckedItems,
      napBlock,
      websiteUrl: facilityUrl,
    },
  }
}

export type ProfileWriteResult = { ok: true } | { ok: false; field: string; problem: string }

/// US-2 AC1's editable fields. AC2's "edits publish within 5 minutes" is met by
/// the caller revalidating the page path, which is immediate rather than five
/// minutes — the requirement is a ceiling, not a target.
export async function saveMarketingCopy(
  actor: Actor,
  facilityId: string,
  input: {
    seoTitle: string
    metaDescription: string
    heroCopy: string
    longDescription: string
  },
): Promise<ProfileWriteResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  // Only the hard maxima refuse. The ideal lengths are guidance the editor
  // shows as a counter — a marketer who wants 70 characters in a title has a
  // reason, and blocking them would move the copy into a spreadsheet.
  if (input.seoTitle.trim().length > TITLE_HARD_MAX) {
    return {
      ok: false,
      field: 'seoTitle',
      problem: `Titles over ${TITLE_HARD_MAX} characters are almost always a paste that ran on. Trim it, or leave it empty to use the generated one.`,
    }
  }
  if (input.metaDescription.trim().length > DESCRIPTION_HARD_MAX) {
    return {
      ok: false,
      field: 'metaDescription',
      problem: `Descriptions over ${DESCRIPTION_HARD_MAX} characters are truncated long before that. Trim it, or leave it empty to use the generated one.`,
    }
  }

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { seoTitle: true, metaDescription: true, heroCopy: true, longDescription: true },
  })

  // Empty means "use the generated default", not "publish an empty title".
  const blank = (value: string) => (value.trim() === '' ? null : value.trim())
  const after = {
    seoTitle: blank(input.seoTitle),
    metaDescription: blank(input.metaDescription),
    heroCopy: blank(input.heroCopy),
    longDescription: blank(input.longDescription),
  }

  await prisma.$transaction(async (tx) => {
    await tx.facility.update({ where: { id: facilityId }, data: after })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'facility.settings_changed',
        entityType: 'Facility',
        entityId: facilityId,
        facilityId,
        before,
        after,
      },
      tx,
    )
  })

  return { ok: true }
}

/// Sparse positions (10, 20, 30…) so inserting between two entries does not
/// renumber the rest.
const POSITION_STEP = 10

async function nextPosition(
  table: 'facilityFaq' | 'facilityPhoto',
  facilityId: string,
): Promise<number> {
  const last =
    table === 'facilityFaq'
      ? await prisma.facilityFaq.findFirst({
          where: { facilityId },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
      : await prisma.facilityPhoto.findFirst({
          where: { facilityId },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
  return (last?.position ?? 0) + POSITION_STEP
}

export async function addFaq(
  actor: Actor,
  facilityId: string,
  input: { question: string; answer: string },
): Promise<ProfileWriteResult> {
  requirePermission(actor, 'facility:settings', facilityId)
  if (!input.question.trim()) return { ok: false, field: 'question', problem: 'Write the question.' }
  if (!input.answer.trim()) return { ok: false, field: 'answer', problem: 'Write the answer.' }

  await prisma.facilityFaq.create({
    data: {
      facilityId,
      question: input.question.trim(),
      answer: input.answer.trim(),
      position: await nextPosition('facilityFaq', facilityId),
    },
  })
  return { ok: true }
}

export async function removeFaq(actor: Actor, facilityId: string, faqId: string): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)
  // Scoped to the facility as well as the id: an id from another facility's
  // form must not delete across the boundary the permission check just drew.
  await prisma.facilityFaq.deleteMany({ where: { id: faqId, facilityId } })
}

export async function addPhoto(
  actor: Actor,
  facilityId: string,
  input: { url: string; alt: string; kind: string },
): Promise<ProfileWriteResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  const url = input.url.trim()
  if (!/^https?:\/\/\S+$/.test(url)) {
    return { ok: false, field: 'url', problem: 'Paste the full address of the image, starting with https://.' }
  }
  if (!input.alt.trim()) {
    // The one refusal in this file that is not about length. WCAG 1.1.1 is an
    // acceptance criterion on customer-facing work here, and "we will add alt
    // text later" is how a photo set ends up with three of eleven.
    return {
      ok: false,
      field: 'alt',
      problem: 'Describe the photo in a few words. A screen reader reads this, and so does image search.',
    }
  }

  await prisma.facilityPhoto.create({
    data: {
      facilityId,
      url,
      alt: input.alt.trim(),
      kind: (input.kind as never) ?? 'other',
      position: await nextPosition('facilityPhoto', facilityId),
    },
  })
  return { ok: true }
}

export async function removePhoto(actor: Actor, facilityId: string, photoId: string): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)
  await prisma.facilityPhoto.deleteMany({ where: { id: photoId, facilityId } })
}

/// US-5 AC2: the checklist is confirmed by a person, with a date.
export async function saveGbpChecklist(
  actor: Actor,
  facilityId: string,
  checked: readonly string[],
): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)

  const valid = GBP_CHECKLIST.map((item) => item.key) as readonly string[]
  const items = checked.filter((key) => valid.includes(key))

  await prisma.facility.update({
    where: { id: facilityId },
    data: {
      gbpCheckedItems: items,
      // Stamped on every save, including one that ticks nothing. "Somebody
      // looked on Tuesday and it was still wrong" is information; leaving the
      // date at its last good value would hide that.
      gbpVerifiedAt: new Date(),
    },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'facility.settings_changed',
    entityType: 'Facility',
    entityId: facilityId,
    facilityId,
    context: { gbpChecked: items, gbpVerifiedAt: new Date().toISOString() },
  })
}
