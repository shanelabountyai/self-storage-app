import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { suppressionList } from '@/lib/admin/suppressions'
import { addSuppressionAction, removeSuppressionAction } from './actions'

export const metadata = { title: 'Suppressions' }

// PRD 05 CN-20 (B-054). Who we have stopped writing to, and why.
//
// The list is org-wide on purpose: an address that bounced or said STOP is not
// reachable from the next site over either. Two of the five reasons cannot be
// lifted from here at all, and the screen says so where the button would be
// rather than only refusing after the click.

const REASON_LABELS: Record<string, string> = {
  unsubscribe: 'Unsubscribed',
  stop: 'Replied STOP',
  hard_bounce: 'Hard bounce',
  complaint: 'Reported as spam',
  manual: 'Added by staff',
  kill_switch: 'Kill switch',
}

function formatWhen(value: Date): string {
  return value.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above. The list itself is shared across every facility — the
        selection only records which site a change was made from.
      </p>
    )
  }
  if (!hasPermissionAnywhere(actor, ['facility:settings'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to this list.</p>
  }

  const facilityId = selected.facility.id
  const rows = await suppressionList(actor, facilityId, q)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Suppressions</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Addresses and numbers nothing is sent to. Shared across every facility, because an address
          that bounced here has not started working somewhere else. Bounces and staff entries can be
          lifted; someone who replied STOP or reported us as spam cannot be added back from here.
        </p>
      </div>

      {/* A plain GET form: search belongs in the URL so a result can be shared
          and the back button behaves. No client JS for a text box. */}
      <form role="search" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Search by address
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <section aria-labelledby="list-heading" className="flex flex-col gap-3">
        <h2 id="list-heading" className="font-medium">
          {rows.length === 0 ? 'Nothing suppressed' : `${rows.length} suppressed`}
          {q ? ` matching “${q}”` : ''}
        </h2>

        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="border-input flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium break-all">{row.address}</span>
                <span className="text-muted-foreground text-xs uppercase">{row.channel}</span>
              </div>
              <p className="text-muted-foreground text-xs">
                {REASON_LABELS[row.reason] ?? row.reason} · {formatWhen(row.createdAt)}
                {row.createdByName ? ` · ${row.createdByName}` : ''}
              </p>
              {row.note && <p className="text-xs text-pretty">{row.note}</p>}

              {row.removable ? (
                // WCAG 3.3.4: a reason is required, so lifting is never a
                // single mis-aimed click — the field has to be filled first.
                <AdminForm
                  action={removeSuppressionAction}
                  label={`Lift the suppression on ${row.address}`}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="facilityId" value={facilityId} />
                  <input type="hidden" name="id" value={row.id} />
                  <Field
                    name="reason"
                    label="Why lift it?"
                    className="min-w-56 flex-1"
                    hint="Recorded against your name in the audit log."
                  />
                  <Button type="submit" variant="outline">
                    Lift
                  </Button>
                </AdminForm>
              ) : (
                <p className="text-muted-foreground text-xs text-pretty">
                  {row.reason === 'complaint'
                    ? 'Cannot be lifted — mailing an address that reported us as spam risks the sending domain for every facility.'
                    : 'Cannot be lifted — this recipient asked us to stop, and only they can opt back in.'}
                </p>
              )}
            </li>
          ))}
          {rows.length === 0 && (
            <li className="text-muted-foreground text-sm">
              {q ? 'No suppression matches that.' : 'Nothing has been suppressed yet.'}
            </li>
          )}
        </ul>
      </section>

      <AdminForm
        action={addSuppressionAction}
        label="Suppress an address"
        className="border-input flex flex-col gap-3 rounded-lg border p-4"
      >
        <h2 className="font-medium">Add one by hand</h2>
        <p className="text-muted-foreground text-sm text-pretty">
          For someone who asked in person or on the phone. Recorded as a staff entry, which is the
          only kind that can be lifted again later.
        </p>
        <input type="hidden" name="facilityId" value={facilityId} />
        <Field name="channel" label="Channel" as="select" defaultValue="email">
          <option value="email">Email</option>
          <option value="sms">Text message</option>
        </Field>
        <Field name="address" label="Address or number" />
        <Field name="note" label="Why" hint="What they said, and to whom." />
        <Button type="submit" className="self-start">
          Suppress
        </Button>
      </AdminForm>
    </div>
  )
}
