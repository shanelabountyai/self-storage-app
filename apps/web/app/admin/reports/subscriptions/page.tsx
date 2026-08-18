import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { REPORT_CATALOG, subscriptionsFor } from '@/lib/admin/report-subscriptions'
import { CADENCE_LABELS, REPORT_CADENCES } from '@storage/core/comms'
import { addSubscriptionAction, removeSubscriptionAction } from './actions'

export const metadata = { title: 'Scheduled reports' }

// PRD 02 US-40 (B-084 part 3). Standing orders for a report by email.

export const dynamic = 'force-dynamic'

export default async function ReportSubscriptionsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        You don&apos;t have access to scheduled reports.
      </p>
    )
  }
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Pick a specific facility above — a scheduled report is about one site, and it goes out on
        that site&apos;s own timezone.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const subscriptions = await subscriptionsFor(actor, facilityId)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Scheduled reports — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Reports that arrive by email without anybody opening the dashboard. They go out at 6am
          this facility&apos;s time — after the overnight billing and delinquency jobs, so the
          figures already include last night&apos;s invoices and late fees.{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
        <p className="text-muted-foreground mt-2 max-w-prose text-sm text-pretty">
          A monthly report says whether its month has been{' '}
          <Link href="/admin/reports/close" className="underline underline-offset-2">
            closed
          </Link>
          , so a figure that can still change is never mistaken for one that cannot.
        </p>
      </div>

      <section aria-labelledby="current-heading" className="flex flex-col gap-3">
        <h2 id="current-heading" className="font-medium">
          Going out now ({subscriptions.length})
        </h2>

        {subscriptions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing is scheduled for this facility yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {subscriptions.map((subscription) => (
              <li
                key={subscription.id}
                className="border-input flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {subscription.reportLabel} · {CADENCE_LABELS[subscription.cadence]}
                  </span>
                  <span className="text-muted-foreground block break-words text-xs">
                    To {subscription.recipients.join(', ')}
                  </span>
                </span>
                <form action={removeSubscriptionAction}>
                  <input type="hidden" name="subscriptionId" value={subscription.id} />
                  <Button type="submit" variant="outline">
                    Stop sending
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AdminForm
        action={addSubscriptionAction}
        label="Schedule a report"
        className="border-input flex flex-col gap-3 rounded-lg border p-4"
      >
        <h2 className="font-medium">Schedule one</h2>
        <input type="hidden" name="facilityId" value={facilityId} />

        <Field name="reportKey" label="Report" as="select" defaultValue={REPORT_CATALOG[0].key}>
          {REPORT_CATALOG.map((report) => (
            <option key={report.key} value={report.key}>
              {report.label} — {report.blurb}
            </option>
          ))}
        </Field>

        <Field name="cadence" label="How often" as="select" defaultValue="weekly">
          {REPORT_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {CADENCE_LABELS[cadence]}
            </option>
          ))}
        </Field>

        <Field
          name="recipients"
          label="Send to"
          hint="Email addresses, separated by commas. A bad address is refused rather than skipped — silently dropping one is how a report goes to three people when somebody meant four."
        />

        <Button type="submit" className="self-start">
          Schedule it
        </Button>
      </AdminForm>
    </div>
  )
}
