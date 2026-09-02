import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import type { PageCheck } from '@storage/core/marketing'
import { indexNowConfig, indexNowKeyPath } from '@/lib/marketing/indexnow'
import { siteOrigin } from '@/lib/marketing/origin'
import { CHECK_LIMIT, runStructuredDataMonitor } from '@/lib/marketing/structured-data-monitor'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Structured data' }

// PRD 04 §7 Phase 3 (B-087 part 1). "Structured-data monitoring alerts."
//
// The nightly job is what raises the alarm; this is where somebody looks after
// it does, and it re-checks live rather than rendering the job's last verdict.
// Same reasoning as the indexation report: a stored "intact" from last night
// is exactly the answer that is wrong on the morning a deploy broke a page.
//
// The IndexNow section is here rather than on its own screen because both
// halves of B-087 part 1 answer one question — is what we publish reaching
// search engines correctly — and a second route for four lines of status is a
// route nobody would find.

export const dynamic = 'force-dynamic'
export const revalidate = 0

function CheckRows({ check }: { check: PageCheck }) {
  const path = new URL(check.url).pathname
  const problems = check.fetchProblem ? [check.fetchProblem] : check.findings.map((f) => f.problem)

  return (
    <tr className="border-input border-b align-top">
      <th scope="row" className="py-2 pr-4 text-left font-normal">
        <a href={check.url} className="underline underline-offset-2" rel="noreferrer" target="_blank">
          {path}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <span className="text-muted-foreground block text-xs">{check.kind}</span>
      </th>
      <td className="py-2 pr-4">
        {/* Every problem listed, not a count. A page missing three address
            fields and a page missing its whole node both read as "3 problems"
            otherwise, and only one of them is urgent. */}
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {problems.map((problem) => (
            <li key={problem} className="text-pretty">
              {problem}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  )
}

export default async function StructuredDataPage() {
  const actor = await getAdminActor()
  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const run = await runStructuredDataMonitor()
  const indexNow = indexNowConfig()
  const origin = siteOrigin()
  const needsAttention = [...run.unreachable, ...run.broken]

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Structured data</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Structured data is invisible on the page, so a page that stops emitting it looks
          completely normal in a browser. This fetches the pages as a crawler gets them and checks
          the markup is still there.{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Intact</dt>
          <dd className="text-lg font-medium tabular-nums">
            {run.intact} of {run.checked}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">With problems</dt>
          <dd className="text-lg font-medium tabular-nums">{run.broken.length}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Couldn&apos;t be fetched</dt>
          <dd className="text-lg font-medium tabular-nums">{run.unreachable.length}</dd>
        </div>
      </dl>

      {run.truncated > 0 && (
        <p role="note" className="border-input rounded-md border p-3 text-sm text-pretty">
          Only the first {CHECK_LIMIT} pages were checked — {run.truncated} more are in the sitemap
          and were not.
        </p>
      )}

      {needsAttention.length === 0 ? (
        <p className="text-sm text-pretty">
          Every monitored page is still emitting the markup it should. Pages with no structured-data
          contract — the homepage, the legal pages, the search page — aren&apos;t checked.
        </p>
      ) : (
        <ScrollRegion aria-label="Pages needing attention">
          <table className="w-full min-w-2xl border-collapse text-sm">
            <caption className="sr-only">
              Pages whose structured data needs attention, unreachable pages first
            </caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">Page</th>
                <th scope="col" className="py-2 pr-4">What&apos;s wrong</th>
              </tr>
            </thead>
            <tbody>
              {needsAttention.map((check) => (
                <CheckRows key={check.url} check={check} />
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      <section aria-labelledby="indexnow-heading" className="flex flex-col gap-2">
        <h2 id="indexnow-heading" className="font-medium">
          IndexNow
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Pages that changed today are submitted to IndexNow overnight, which tells Bing, Yandex,
          Seznam and Naver to re-crawl them. Google doesn&apos;t take part — it retired its sitemap
          ping in 2023, and the{' '}
          <Link href="/admin/reports/indexation" className="underline underline-offset-2">
            indexation report
          </Link>{' '}
          is how we see what Google has done.
        </p>
        {indexNow.configured ? (
          <p className="text-sm text-pretty">
            Configured. The key file is served at{' '}
            <a
              href={`${origin}${indexNowKeyPath(indexNow.config.key)}`}
              className="underline underline-offset-2"
              rel="noreferrer"
              target="_blank"
            >
              <code>{indexNowKeyPath(indexNow.config.key)}</code>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            , which is how search engines confirm we own this site. If it doesn&apos;t load,
            submissions are being rejected.
          </p>
        ) : (
          // Names the variable, same as the indexation report: somebody has to
          // go and set this, and "not configured" costs them a search.
          <div role="note" className="border-input max-w-prose rounded-md border p-4 text-sm">
            <p className="font-medium">IndexNow isn&apos;t set up, so nothing is being submitted.</p>
            {indexNow.problem ? (
              <p className="mt-2 text-pretty">{indexNow.problem}</p>
            ) : (
              <p className="mt-2 text-pretty">
                Set <code>{indexNow.missing.join(', ')}</code> to any 8–128 characters of letters,
                digits and hyphens — it isn&apos;t a secret, it&apos;s a value we publish to prove
                we own the domain. <code>.env.example</code> has the note.
              </p>
            )}
          </div>
        )}
      </section>

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        Checked live each time this page is opened, by fetching the pages as they are actually
        served rather than by asking the code what it would render. The same check runs nightly and
        emails the owner when a page needs attention.
      </p>
    </div>
  )
}
