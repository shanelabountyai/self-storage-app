import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { INDEX_STATE_LABELS, summarise, type UrlIndexation } from '@storage/core/marketing'
import sitemap from '@/app/sitemap'
import {
  INSPECT_LIMIT,
  inspectUrls,
  searchConsoleConfig,
} from '@/lib/marketing/search-console'

export const metadata = { title: 'Indexation' }

// PRD 04 §7 Phase 2 (B-082 part 5). "Search Console integration for indexation
// monitoring."
//
// The URLs come from `sitemap()` itself, not from a second list — this report
// exists to answer "has Google indexed what we told it to index", and asking
// about a different set of URLs than the sitemap advertises would answer a
// question nobody has.
//
// Live every time it is opened. No caching and no stored history: a stale
// "indexed" is worse than no answer, and the whole point is to catch a page
// that has stopped being indexed.

export const dynamic = 'force-dynamic'
export const revalidate = 0

function formatCrawl(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10)
}

function StateCell({ row }: { row: UrlIndexation }) {
  return (
    <td className="py-2 pr-4">
      {/* The state in words. No colour-coded dot: 1.4.1 forbids carrying the
          whole meaning of a row in a hue, and "Not indexed" is shorter to read
          than a legend anyway. */}
      <span className={row.state === 'indexed' ? 'text-muted-foreground' : 'font-medium'}>
        {INDEX_STATE_LABELS[row.state]}
      </span>
      {/* Google's own sentence, verbatim. An operator searching for the exact
          phrase in Google's documentation should find it, which a paraphrase
          would prevent. */}
      {row.coverageState && (
        <span className="text-muted-foreground block text-xs">{row.coverageState}</span>
      )}
      {row.problem && <span className="block text-xs">{row.problem}</span>}
    </td>
  )
}

export default async function IndexationPage() {
  const actor = await getAdminActor()
  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const configured = searchConsoleConfig()
  const entries = await sitemap()
  const urls = entries.map((entry) => entry.url)

  const outcome = configured.configured ? await inspectUrls(urls) : null
  const rows = outcome?.ok ? outcome.rows : []
  const summary = summarise(rows)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Indexation</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Of the {urls.length} pages our sitemap advertises, which has Google actually indexed?{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
      </div>

      {!configured.configured ? (
        // Named variables, not "not configured". Somebody has to go and set
        // these, and a message that does not say which ones costs them a search
        // through the repo.
        <div role="note" className="border-input max-w-prose rounded-md border p-4 text-sm">
          <p className="font-medium">Search Console isn&apos;t connected yet.</p>
          <p className="mt-2 text-pretty">
            Nothing here has been checked, and nothing below is a guess about what Google has
            done — this page shows no verdicts rather than invented ones.
          </p>
          <p className="mt-2">Set these, then reload:</p>
          <ul className="mt-1 list-disc pl-5">
            {configured.missing.map((name) => (
              <li key={name}>
                {/* B-201. `GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL` has no break
                    opportunity in it, so it ran to 347px on a 320px screen —
                    the same fault, and the same fix, as B-094's JSON example on
                    `/admin/units/setup` (1.4.10). */}
                <code className="break-all">{name}</code>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-pretty">
            They need a Google Cloud service account added as a user on the Search Console
            property, with read-only access. <code>.env.example</code> says which value is which.
          </p>
        </div>
      ) : outcome && !outcome.ok ? (
        <div role="note" className="border-input max-w-prose rounded-md border p-4 text-sm">
          <p className="font-medium">Couldn&apos;t reach Search Console.</p>
          <p className="mt-2 text-pretty">{outcome.problem}</p>
          <p className="text-muted-foreground mt-2 text-pretty">
            Nothing below is stale data — this report holds none, so a failed check shows nothing
            rather than yesterday&apos;s answer.
          </p>
        </div>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Indexed</dt>
              <dd className="text-lg font-medium tabular-nums">
                {summary.indexed} of {summary.total}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Not indexed</dt>
              <dd className="text-lg font-medium tabular-nums">{summary.notIndexed}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Couldn&apos;t be fetched</dt>
              <dd className="text-lg font-medium tabular-nums">{summary.errors}</dd>
            </div>
          </dl>

          {outcome?.ok && outcome.truncated > 0 && (
            // Said out loud rather than silently truncated. A report that
            // quietly checks the first forty of ninety URLs reads as "fifty
            // pages are fine" to somebody counting rows.
            <p role="note" className="border-input rounded-md border p-3 text-sm text-pretty">
              Only the first {INSPECT_LIMIT} URLs were checked — {outcome.truncated} more are in
              the sitemap and were not. Google caps URL inspections, so this report checks a
              bounded slice rather than the whole site.
            </p>
          )}

          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">
                Every URL in the sitemap with its Search Console index status, pages needing
                attention first
              </caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">Page</th>
                  <th scope="col" className="py-2 pr-4">Status</th>
                  <th scope="col" className="py-2 pr-4">Last crawled</th>
                </tr>
              </thead>
              <tbody>
                {/* Needs-attention first, then the rest. An operator opens this
                    to find the problems, not to admire the indexed pages. */}
                {[
                  ...summary.needsAttention,
                  ...rows.filter((row) => row.state === 'indexed'),
                ].map((row) => (
                  <tr key={row.url} className="border-input border-b">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      <a
                        href={row.url}
                        className="underline underline-offset-2"
                        rel="noreferrer"
                        target="_blank"
                      >
                        {new URL(row.url).pathname}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </th>
                    <StateCell row={row} />
                    <td className="text-muted-foreground py-2 pr-4 tabular-nums">
                      {formatCrawl(row.lastCrawledAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        Checked live each time this page is opened, against the exact URLs our sitemap advertises.
        Nothing is stored, so a page that stops being indexed shows up here rather than being
        masked by a cached answer from last week.
      </p>
    </div>
  )
}
