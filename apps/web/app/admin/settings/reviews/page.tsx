import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reviewSettingsFor, reviewsForFacility, reviewRequestStats } from '@/lib/admin/reviews'
import { REVIEW_SOURCES, REVIEW_SOURCE_LABELS } from '@storage/core/reviews'
import { createReviewAction, setReviewVisibilityAction, updateReviewSettingsAction } from './actions'

export const metadata = { title: 'Reviews' }

// PRD 04 §3.4 FR-REV-1/FR-REV-2, US-7 (B-071). Manual review entry, the
// review-request settings, and the visibility toggle FR-REV-2 allows.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

export default async function ReviewsSettingsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['facility:settings'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to this.</p>
  }

  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — reviews and the request link are per-site.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const [settings, reviews, stats] = await Promise.all([
    reviewSettingsFor(actor, facilityId),
    reviewsForFacility(actor, facilityId),
    reviewRequestStats(actor, facilityId),
  ])

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-lg font-semibold">Reviews — {selected.facility.name}</h1>

      <section aria-labelledby="settings-heading" className="flex flex-col gap-3">
        <h2 id="settings-heading" className="text-base font-medium">
          Review requests
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Sent automatically once a tenant has been in for the delay below — once per tenancy. A
          facility with no Google review link set here cannot send any.
        </p>
        <form action={updateReviewSettingsAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="facilityId" value={facilityId} />
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Google review link
            <input
              name="googleReviewUrl"
              type="url"
              placeholder="https://g.page/r/…/review"
              defaultValue={settings.googleReviewUrl ?? ''}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Send after (days)
            <input
              name="reviewRequestDelayDays"
              type="number"
              min={0}
              defaultValue={settings.reviewRequestDelayDays}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium"
            >
              Save
            </button>
          </div>
        </form>
        <p className="text-muted-foreground text-sm">
          {stats.sent} sent · {stats.suppressed} suppressed
          {stats.failed > 0 && ` · ${stats.failed} failed`}
        </p>
      </section>

      <section aria-labelledby="add-heading" className="flex flex-col gap-3">
        <h2 id="add-heading" className="text-base font-medium">
          Add a review
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Transcribe it exactly as posted, with attribution. Once saved the text cannot be edited —
          only hidden, if it needs to come off the page.
        </p>
        <form action={createReviewAction} className="border-input flex flex-col gap-3 rounded-lg border p-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Rating
              <select name="rating" defaultValue="5" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm">
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} star{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Reviewer name
              <input
                name="reviewerDisplayName"
                required
                placeholder="As Google displayed it"
                className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Review date
              <input name="reviewDate" type="date" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Source
              <select name="source" defaultValue="manual_google" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm">
                {REVIEW_SOURCES.filter((s) => s !== 'google_api').map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Review text
            <textarea name="text" required rows={4} className="border-input bg-background rounded-md border px-3 py-2 text-sm" />
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent min-h-11 self-start rounded-md border px-4 text-sm font-medium"
          >
            Add review
          </button>
        </form>
      </section>

      <section aria-labelledby="list-heading" className="flex flex-col gap-3">
        <h2 id="list-heading" className="text-base font-medium">
          All reviews ({reviews.length})
        </h2>
        {reviews.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing added yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => (
              <li key={review.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {'★'.repeat(review.rating)}
                      {'☆'.repeat(5 - review.rating)} — {review.reviewerDisplayName}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {formatDate(review.reviewDate)} · {REVIEW_SOURCE_LABELS[review.source]}
                      {!review.visible && ' · Hidden'}
                    </p>
                    <p className="mt-2 text-sm text-pretty">{review.text}</p>
                  </div>
                  <form action={setReviewVisibilityAction}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="visible" value={(!review.visible).toString()} />
                    <button type="submit" className="text-sm underline underline-offset-2">
                      {review.visible ? 'Hide' : 'Show'}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
