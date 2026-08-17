import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { DUPLICATE_THRESHOLD, duplicateReport } from '@storage/core/marketing'
import { contentCorpus } from '@/lib/marketing/content-corpus'

export const metadata = { title: 'Duplicate content' }

// PRD 04 §7 Phase 2 (B-082 part 6). Duplicate content across the whole site.
//
// B-067 warns a marketer at the moment they type a meta description that
// matches another facility's. That is the right warning in the right place, and
// it covers one field on the page being edited. This is the other half: every
// page, every prose field, including the copy the product GENERATES and no
// editor ever opens.
//
// Live on each open. There is nothing to cache — the corpus is a handful of
// rows and a few pure functions — and a cached answer would be exactly the
// wrong thing on a screen whose whole job is to notice that something changed.

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DuplicateContentPage() {
  const actor = await getAdminActor()
  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const report = duplicateReport(await contentCorpus())
  const percent = (value: number) => `${Math.round(value * 100)}%`

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Duplicate content</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Pages that say nearly the same thing as each other.{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
      </div>

      {report.pairs.length === 0 ? (
        // The count matters. "Nothing found" and "we checked 41 pieces of text
        // and found nothing" are different claims, and only the second one is
        // reassuring.
        <p className="text-sm text-pretty">
          No pages are more than {percent(DUPLICATE_THRESHOLD)} alike. Checked {report.compared}{' '}
          pieces of text.
        </p>
      ) : (
        <>
          <p className="text-sm text-pretty">
            {report.pairs.length} {report.pairs.length === 1 ? 'pair' : 'pairs'} above{' '}
            {percent(DUPLICATE_THRESHOLD)} alike, out of {report.compared} pieces of text.
          </p>

          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">
                Pairs of pages with similar text, authored collisions first
              </caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">What</th>
                  <th scope="col" className="py-2 pr-4">These two pages</th>
                  <th scope="col" className="py-2 pr-4 text-right">Alike</th>
                  <th scope="col" className="py-2 pr-4">What to do</th>
                </tr>
              </thead>
              <tbody>
                {report.pairs.map((pair) => (
                  <tr key={`${pair.left.key}|${pair.right.key}`} className="border-input border-b">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      {pair.kind}
                    </th>
                    <td className="py-2 pr-4">
                      <Link href={pair.left.url} className="underline underline-offset-2">
                        {pair.left.label}
                      </Link>
                      <span className="text-muted-foreground"> and </span>
                      <Link href={pair.right.url} className="underline underline-offset-2">
                        {pair.right.label}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {percent(pair.similarity)}
                    </td>
                    <td className="py-2 pr-4 text-pretty">
                      {/* The fix depends entirely on who wrote it, which is why
                          `origin` is carried through rather than inferred from
                          the kind. Two pasted descriptions and two templated
                          city pages are the same number and completely
                          different jobs. */}
                      {/* Not "write better copy" for the generated case. There
                          is no city description to edit — the intros are
                          derived from the facility records on purpose — so
                          telling somebody to rewrite one sends them hunting for
                          a field that does not exist. Naming it as a product
                          gap is the honest instruction. */}
                      {pair.bothGenerated
                        ? 'Generated from the facility records, and alike because the records are alike. There is no city description to edit today — if these pages need to read differently, that is a product change rather than a copy change.'
                        : 'Somebody wrote both. Check whether one was pasted from the other and rewrite the weaker one.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {report.singletons.length > 0 && (
        // "No duplicates in guides" and "there is only one guide" are different
        // statements, and a report that renders the first when the second is
        // true has told somebody their site is fine when nothing was compared.
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Nothing to compare for: {report.singletons.join(', ')} — there is only one of each, so
          these are unchecked rather than clean.
        </p>
      )}

      <div className="text-muted-foreground flex max-w-prose flex-col gap-2 text-xs text-pretty">
        <p>
          Compared within a kind and never across kinds: a search-result description and a
          long-form page description would score low against each other because of their length
          rather than their content, and the pairs that surfaced would be noise.
        </p>
        <p>
          Generated copy is included on purpose. The city page intros are derived from the
          facilities in each city, so they are alike by construction — this report is what says
          whether that is still acceptable or has become the thin content it was meant to hold off.
        </p>
      </div>
    </div>
  )
}
