import Link from 'next/link'
import { DataTable } from '@/components/ui/data-table'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { commsDashboard, type RateRow } from '@/lib/admin/comms-dashboard'
import { reportRangeForActor } from '@/lib/admin/reports'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Deliverability' }

// PRD 05 CN-19 (B-075). "A delivery dashboard: sends by day/facility/template,
// delivery rate, bounce rate, SMS failure rate, opt-out rate, and a failure
// queue... with per-tenant follow-up tasks."
//
// The follow-up-task half of the AC is already built (B-054's bounce
// handling raises `no_reachable_channel`) — this page is the reporting half:
// the rates, and links into the failure queue and the dead-letter surface
// rather than reimplementing either as a second list.

function percent(ratio: number | null): string {
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`
}

function rateCells(row: RateRow, showSms: boolean) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{row.counts.sent + row.counts.delivered + row.counts.bounced + row.counts.failed}</td>
      <td className="px-3 py-2 text-right tabular-nums">{percent(row.deliveryRate)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{percent(row.bounceRate)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{showSms ? percent(row.smsFailureRate) : '—'}</td>
    </>
  )
}

export default async function DeliverabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; facility?: string }>
}) {
  const params = await searchParams
  const actor = await getAdminActor()
  const range = await reportRangeForActor(actor, params)

  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const report = await commsDashboard(actor, {
    from: range.start,
    to: range.end,
    facilityId: params.facility || undefined,
  })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deliverability — {range.label}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Sends, delivery and bounce rates by template.{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.fromValue}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.toValue}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          />
        </label>
        <button
          type="submit"
          className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium"
        >
          Apply
        </button>
        <Link
          href={`/admin/reports/deliverability.csv?from=${range.fromValue}&to=${range.toValue}`}
          className="text-sm underline underline-offset-2"
        >
          Export CSV
        </Link>
      </form>

      <section aria-labelledby="overall-heading" className="flex flex-col gap-3">
        <h2 id="overall-heading" className="font-medium">
          Overall
        </h2>
        <ScrollRegion aria-label="Deliverability summary">
          <DataTable className="min-w-md">
            <caption className="sr-only">Sends, delivery rate, bounce rate and SMS failure rate for {range.label}</caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Sent</th>
                <th scope="col" className="px-3 py-2 font-semibold">Delivered</th>
                <th scope="col" className="px-3 py-2 font-semibold">Bounced</th>
                <th scope="col" className="px-3 py-2 font-semibold">SMS failed</th>
              </tr>
            </DataTable.Head>
            <tbody>
              <DataTable.Row>{rateCells(report.overall, true)}</DataTable.Row>
            </tbody>
          </DataTable>
        </ScrollRegion>
      </section>

      <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
        <h2 id="templates-heading" className="font-medium">
          By template
        </h2>
        <ScrollRegion aria-label="By template and channel">
          <DataTable className="min-w-2xl">
            <caption className="sr-only">Sends and delivery outcomes broken down by template and channel</caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Template</th>
                <th scope="col" className="px-3 py-2 font-semibold">Channel</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sent</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Delivered</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bounced</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">SMS failed</th>
              </tr>
            </DataTable.Head>
            <tbody>
              {report.templates.length === 0 && (
                <DataTable.Row>
                  <td colSpan={6} className="px-3 text-muted-foreground py-4 text-center">
                    Nothing sent in this range.
                  </td>
                </DataTable.Row>
              )}
              {report.templates.map((row) => (
                <DataTable.Row key={`${row.templateKey}:${row.channel}`} className="border-input border-b">
                  <th scope="row" className="px-3 py-2 text-left font-normal">{row.templateKey}</th>
                  <td className="px-3 py-2">{row.channel === 'sms' ? 'Text' : 'Email'}</td>
                  {rateCells(row, row.channel === 'sms')}
                </DataTable.Row>
              ))}
            </tbody>
          </DataTable>
        </ScrollRegion>
      </section>

      <section aria-labelledby="daily-heading" className="flex flex-col gap-3">
        <h2 id="daily-heading" className="font-medium">
          By day
        </h2>
        <ScrollRegion aria-label="Sends per day">
          <DataTable className="min-w-md">
            <caption className="sr-only">Sends per day for {range.label}</caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Day</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sent</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Delivered</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bounced</th>
              </tr>
            </DataTable.Head>
            <tbody>
              {/* The same colSpan row the templates table above carries. Without
                  it a range with no sends renders four column headers over an
                  empty tbody, which axe flags as `th-has-data-cells` and a
                  screen reader reads as a table that is simply missing. */}
              {report.daily.length === 0 && (
                <DataTable.Row>
                  <td colSpan={4} className="px-3 text-muted-foreground py-4 text-center">
                    Nothing sent in this range.
                  </td>
                </DataTable.Row>
              )}
              {report.daily.map((row) => (
                <DataTable.Row key={row.day} className="border-input border-b">
                  <th scope="row" className="px-3 py-2 text-left font-normal">{row.day}</th>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.counts.sent + row.counts.delivered + row.counts.bounced + row.counts.failed}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{percent(row.deliveryRate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{percent(row.bounceRate)}</td>
                </DataTable.Row>
              ))}
            </tbody>
          </DataTable>
        </ScrollRegion>
      </section>

      <section aria-labelledby="failures-heading" className="flex flex-col gap-3">
        <h2 id="failures-heading" className="font-medium">
          Failure queue and dead letters
        </h2>
        <p className="text-sm">
          <Link
            href={`/admin/tasks?type=no_reachable_channel${params.facility ? `&facility=${params.facility}` : ''}`}
            className="underline underline-offset-2"
          >
            {report.failureQueueCount} open follow-up task{report.failureQueueCount === 1 ? '' : 's'}
          </Link>{' '}
          — a bounce or an invalid number the tenant needs reaching another way.
        </p>

        {report.deadLetters.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing has exhausted its retries and needed a human — this is the state to expect.
          </p>
        ) : (
          <ScrollRegion aria-label="Exhausted retries">
            <DataTable className="min-w-2xl">
              <caption className="sr-only">Events that exhausted every retry attempt and need a human look</caption>
              <DataTable.Head>
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Event</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Entity</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Consumer</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Last error</th>
                  <th scope="col" className="px-3 py-2 font-semibold">When</th>
                </tr>
              </DataTable.Head>
              <tbody>
                {report.deadLetters.map((row) => (
                  <DataTable.Row key={row.id} className="border-input border-b">
                    <td className="px-3 py-2">{row.eventName}</td>
                    <td className="px-3 py-2">
                      {row.entityType} {row.entityId}
                    </td>
                    <td className="px-3 py-2">{row.consumer}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={row.lastError ?? ''}>
                      {row.lastError ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {row.completedAt
                        ? new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(row.completedAt)
                        : '—'}
                    </td>
                  </DataTable.Row>
                ))}
              </tbody>
            </DataTable>
          </ScrollRegion>
        )}
      </section>

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        Opt-out rate is not split by facility: the shared suppression list (CN-20) is address-scoped
        across every facility, by design, so a STOP or unsubscribe from one tenant cannot be
        attributed to a single site. See Suppressions for the address-level list.
      </p>
    </div>
  )
}
