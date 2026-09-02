import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { managementPack } from '@/lib/admin/management-pack'
import { periodsFor } from '@/lib/admin/accounting-close'
import { businessDateFor } from '@storage/core/jobs'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Management pack' }

// PRD 02 US-40 (B-084 part 4). The monthly pack.
//
// **HTML, not the PDF US-40 names** — D-64: no library in this runtime emits
// tagged PDFs, and an untagged one is a screen-reader dead end. What an owner
// who wants a file does is print this page, which is a worse handoff and the
// trade B-023 already made deliberately.
//
// Rendered from the SAME document the scheduled email sends, so the page and
// the email cannot say different things about one month.

export const dynamic = 'force-dynamic'

/// B-220 defect 1. `now` must already be the facility-local calendar date —
/// `businessDateFor(new Date(), timezone)`, which returns UTC midnight of that
/// date, so the UTC getters below read the LOCAL month.
///
/// It used to be handed the raw instant, and the five hours between UTC
/// midnight and Central midnight are what that cost: at 2026-09-01T00:32Z the
/// default was August, but in America/Chicago it was still 19:32 on 31 August
/// and August had not ended. The page then rendered a pack for a month that was
/// still running, under a name claiming all of it — which the comment beside
/// `months` below forbids in as many words — and the month being shown appeared
/// in neither the nav nor `aria-current`, because `periodsFor` filters on
/// `.ended`, which is reckoned locally. Invisible outside those five hours,
/// which is how it survived until a 19:32 run.
function previousMonth(now: Date): { year: number; month: number } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

export default async function ManagementPackPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  const params = await searchParams

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        You don&apos;t have access to financial reports.
      </p>
    )
  }
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Pick a specific facility above — a pack covers one site&apos;s month, on that site&apos;s own
        timezone.
      </p>
    )
  }

  const fallback = previousMonth(businessDateFor(new Date(), selected.facility.timezone))
  const year = Number(params.year) || fallback.year
  const month = Number(params.month) || fallback.month
  const safeMonth = month >= 1 && month <= 12 ? month : fallback.month

  const facilityId = selected.facility.id
  const pack = await managementPack(actor, facilityId, year, safeMonth)
  // Only months that have ENDED can be packed — the same rule the close
  // follows, for the same reason: a part-month under a name claiming all of it
  // is wrong in one direction for every figure.
  const months = (await periodsFor(actor, facilityId).catch(() => [])).filter((period) => period.ended)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">{pack.document.title}</h1>
        <p
          className={
            pack.driftCount > 0
              ? 'mt-2 rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-pretty text-amber-950'
              : 'text-muted-foreground mt-2 max-w-prose text-sm text-pretty'
          }
          /* B-245: no `role="alert"`. The drift warning is the first thing on
             the page and is read in document order; wearing an alert role made
             it an assertive interruption every time the report was opened, for
             prose that had not changed. */
        >
          {/* First thing on the page, never last: these numbers get quoted, and
              "can this still change?" decides whether they should be. */}
          {pack.document.intro}
        </p>
        <p className="text-muted-foreground mt-2 text-sm text-pretty">
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          {' · '}
          <Link href="/admin/reports/subscriptions" className="underline underline-offset-2">
            Have this emailed every month
          </Link>
        </p>
      </div>

      {months.length > 0 && (
        <nav aria-label="Other months" className="flex flex-wrap gap-2">
          {months.slice(0, 12).map((period) => {
            const current = period.year === year && period.month === safeMonth
            return (
              <Link
                key={period.label}
                href={`/admin/reports/pack?year=${period.year}&month=${period.month}`}
                aria-current={current ? 'page' : undefined}
                // B-251 / SC 1.4.11. `bg-accent` is `oklch(0.97 0 0)` on a white
                // `--background` — **1.09:1**, and 1.31:1 in dark. Twelve month
                // chips of which one was "current" at a 1.09:1 tint plus a
                // 500-vs-400 weight bump at 14px is not a state a reader with
                // reduced contrast sensitivity can pick out. 1.4.1 Use of Colour
                // was met (weight is a non-colour signal) and `aria-current`
                // tells assistive technology correctly, so this was a sighted
                // low-vision problem specifically.
                //
                // `border-foreground` (19.8:1 light, 19.0:1 dark) rather than
                // `border-input` (3.6:1 / 3.3:1, which would clear the floor):
                // the UNSELECTED chip is already `border-input`, so reusing it
                // would leave thickness as the only difference. Both states
                // carry `border-2` so the selected one does not grow by a pixel
                // and nudge the row.
                className={
                  current
                    ? 'bg-accent border-foreground inline-flex min-h-11 items-center rounded-md border-2 px-3 text-sm font-medium'
                    : 'border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border-2 px-3 text-sm'
                }
              >
                {/* The word, not only the highlight (WCAG 1.4.1 / 4.1.2) —
                    `aria-current` names the one being shown. */}
                {period.label}
                {period.closedAt ? ' · closed' : ' · open'}
              </Link>
            )
          })}
        </nav>
      )}

      {pack.document.sections.map((section) => (
        <section
          key={section.heading}
          aria-labelledby={section.heading.replace(/\s+/g, '-').toLowerCase()}
          className="flex flex-col gap-2"
        >
          <h2
            id={section.heading.replace(/\s+/g, '-').toLowerCase()}
            className="text-base font-medium"
          >
            {section.heading}
          </h2>
          {(section.paragraphs ?? []).map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground text-sm text-pretty">
              {paragraph}
            </p>
          ))}
          {section.table && (
            <ScrollRegion aria-label={section.table.caption}>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{section.table.caption}</caption>
                <thead>
                  <tr className="text-muted-foreground">
                    {section.table.columns.map((column, index) => (
                      <th
                        key={column}
                        scope="col"
                        className={index === 0 ? 'pb-1 font-normal' : 'pb-1 text-right font-normal'}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row) => (
                    <tr key={row[0]}>
                      <th scope="row" className="py-1 text-left font-normal">
                        {row[0]}
                      </th>
                      {row.slice(1).map((cell, index) => (
                        <td key={index} className="py-1 text-right tabular-nums">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </section>
      ))}

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        {pack.document.footer}
      </p>
    </div>
  )
}
