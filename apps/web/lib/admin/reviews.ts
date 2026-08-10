import { prisma, type ReviewSource } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { validateReview, type ReviewProblem } from '@storage/core/reviews'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 04 §3.4 FR-REV-1/FR-REV-2, US-7 (B-071). Staff-side review management:
// transcribing, hiding, and the two settings US-7 AC1 needs a form for.

export type ReviewRow = {
  id: string
  rating: number
  text: string
  reviewerDisplayName: string
  reviewDate: Date
  source: ReviewSource
  visible: boolean
  createdAt: Date
}

export async function reviewsForFacility(actor: Actor, facilityId: string): Promise<ReviewRow[]> {
  requirePermission(actor, 'facility:settings', facilityId)

  const rows = await prisma.review.findMany({
    where: { facilityId },
    orderBy: [{ reviewDate: 'desc' }, { createdAt: 'desc' }],
  })

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    text: row.text,
    reviewerDisplayName: row.reviewerDisplayName,
    reviewDate: row.reviewDate,
    source: row.source,
    visible: row.visible,
    createdAt: row.createdAt,
  }))
}

export type CreateReviewInput = {
  rating: number
  text: string
  reviewerDisplayName: string
  reviewDate: Date
  source: ReviewSource
}

export type CreateReviewResult = { ok: true; id: string } | { ok: false; problems: ReviewProblem[] }

/// FR-REV-1. No update function exists beside this and `setReviewVisibility` —
/// FR-REV-2's "admin can hide (not edit)" is enforced by what this file does
/// NOT export, not by a permission check on an edit path.
export async function createReview(
  actor: Actor,
  facilityId: string,
  input: CreateReviewInput,
): Promise<CreateReviewResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  const problems = validateReview(input)
  if (problems.length > 0) return { ok: false, problems }

  const review = await prisma.review.create({
    data: {
      facilityId,
      rating: input.rating,
      text: input.text.trim(),
      reviewerDisplayName: input.reviewerDisplayName.trim(),
      reviewDate: input.reviewDate,
      source: input.source,
      createdByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
    },
    select: { id: true },
  })

  return { ok: true, id: review.id }
}

/// The only thing FR-REV-2 lets an admin change about an existing review.
export async function setReviewVisibility(actor: Actor, reviewId: string, visible: boolean): Promise<void> {
  const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })
  requirePermission(actor, 'facility:settings', review.facilityId)
  if (review.visible === visible) return

  await prisma.$transaction(async (tx) => {
    await tx.review.update({ where: { id: reviewId }, data: { visible } })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: review.facilityId,
        action: 'review.visibility_changed',
        entityType: 'Review',
        entityId: reviewId,
        context: { visible, reviewerDisplayName: review.reviewerDisplayName },
      },
      tx,
    )
  })
}

export type ReviewSettings = { googleReviewUrl: string | null; reviewRequestDelayDays: number }

export async function reviewSettingsFor(actor: Actor, facilityId: string): Promise<ReviewSettings> {
  requirePermission(actor, 'facility:settings', facilityId)
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { googleReviewUrl: true, reviewRequestDelayDays: true },
  })
  return facility
}

export async function updateReviewSettings(
  actor: Actor,
  facilityId: string,
  input: { googleReviewUrl: string | null; reviewRequestDelayDays: number },
): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)
  if (!Number.isInteger(input.reviewRequestDelayDays) || input.reviewRequestDelayDays < 0) {
    throw new Error('The review-request delay must be a whole number of days.')
  }

  await recordAudit({
    actor: toAuditActor(actor),
    facilityId,
    action: 'facility.settings_changed',
    entityType: 'Facility',
    entityId: facilityId,
    context: { googleReviewUrl: input.googleReviewUrl, reviewRequestDelayDays: input.reviewRequestDelayDays },
  })

  await prisma.facility.update({
    where: { id: facilityId },
    data: {
      googleReviewUrl: input.googleReviewUrl?.trim() || null,
      reviewRequestDelayDays: input.reviewRequestDelayDays,
    },
  })
}

export type ReviewRequestStats = { sent: number; suppressed: number; failed: number }

/// AC3: "Send/... tracked and reported per facility." Read from the same
/// `Message` log every other template already writes to — there is no
/// review-specific tracking table, because the comms engine's own delivery
/// record is that table.
export async function reviewRequestStats(actor: Actor, facilityId: string): Promise<ReviewRequestStats> {
  requirePermission(actor, 'facility:settings', facilityId)

  const rows = await prisma.message.groupBy({
    by: ['status'],
    where: { facilityId, templateKey: 'review_request' },
    _count: { _all: true },
  })

  const byStatus = new Map(rows.map((row) => [row.status, row._count._all]))
  return {
    sent: (byStatus.get('sent') ?? 0) + (byStatus.get('delivered') ?? 0),
    suppressed: byStatus.get('suppressed') ?? 0,
    failed: (byStatus.get('failed') ?? 0) + (byStatus.get('bounced') ?? 0),
  }
}
