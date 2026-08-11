import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { drawerView, openSessionFor } from '@/lib/admin/drawer'
import { formatCents } from '@/lib/format'
import { closeDrawerAction, openDrawerAction } from './actions'

export const metadata = { title: 'Drawer' }

// PRD 02 US-33 (B-078). The drawer session: open with a counted float, close
// with a counted total, and explain anything past the threshold.
//
// This is the screen B-039's summary page deliberately stopped short of: it
// said a close-out "reconciled against nothing counted would look like
// accountability without being it". Everything here is counted.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(date)
}

export default async function DrawerPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['drawer:manage'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to the drawer.</p>
  }

  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — a drawer is a physical till at one site.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const open = await openSessionFor(facilityId)
  const view = open ? await drawerView(actor, open.id) : null

  return (
    <div className="flex max-w-2xl flex-col gap-6 print:max-w-none">
      <div className="print:hidden">
        <h1 className="text-lg font-semibold">Drawer — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Cash and cheques taken at the counter post to the open session.{' '}
          <Link href="/admin/pos" className="underline underline-offset-2">
            Back to POS
          </Link>
          .
        </p>
      </div>

      {!view ? (
        <section aria-labelledby="open-heading" className="flex flex-col gap-3">
          <h2 id="open-heading" className="font-medium">
            No drawer open
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm text-pretty">
            Count the float into the till and enter it. Payments taken with no drawer open still
            record — they show as unreconciled on the deposits report rather than being refused,
            because nobody should be stopped from taking money.
          </p>
          <AdminForm action={openDrawerAction} label="Open the drawer" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            <Field
              name="openingFloat"
              label="Opening float ($)"
              inputMode="decimal"
              required
              hint="What you counted into the till before trading."
            />
            <Button type="submit">Open drawer</Button>
          </AdminForm>
        </section>
      ) : (
        <>
          <section aria-labelledby="slip-heading" className="flex flex-col gap-3">
            <h2 id="slip-heading" className="font-medium">
              Deposit slip — {formatDate(view.businessDate)}
            </h2>
            <p className="text-muted-foreground text-sm">
              Opened {formatTime(view.openedAt)} by {view.openedByName ?? 'unknown'}.
            </p>

            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
              <dt>Opening float</dt>
              <dd className="text-right tabular-nums">{formatCents(view.slip.openingFloatCents)}</dd>
              <dt>Cash taken</dt>
              <dd className="text-right tabular-nums">{formatCents(view.slip.cashTakenCents)}</dd>
              <dt>Change given</dt>
              <dd className="text-right tabular-nums">−{formatCents(view.slip.changeGivenCents)}</dd>
              {view.slip.cashRefundedCents > 0 && (
                <>
                  <dt>Cash refunded</dt>
                  <dd className="text-right tabular-nums">−{formatCents(view.slip.cashRefundedCents)}</dd>
                </>
              )}
              <dt className="border-input border-t pt-1 font-medium">Cash expected in drawer</dt>
              <dd className="border-input border-t pt-1 text-right font-medium tabular-nums">
                {formatCents(view.slip.expectedCashCents)}
              </dd>
              <dt className="text-muted-foreground">of which to bank (above float)</dt>
              <dd className="text-muted-foreground text-right tabular-nums">
                {formatCents(view.slip.depositCashCents)}
              </dd>
              <dt className="pt-2">Cheques and money orders</dt>
              <dd className="pt-2 text-right tabular-nums">{formatCents(view.slip.expectedChecksCents)}</dd>
              <dt className="text-muted-foreground">Card (never in the drawer)</dt>
              <dd className="text-muted-foreground text-right tabular-nums">{formatCents(view.slip.cardCents)}</dd>
            </dl>

            {view.checks.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Cheques and money orders in this drawer session</caption>
                  <thead>
                    <tr className="border-input border-b text-left">
                      <th scope="col" className="py-2 pr-4">Receipt</th>
                      <th scope="col" className="py-2 pr-4">Tenant</th>
                      <th scope="col" className="py-2 pr-4">Cheque #</th>
                      <th scope="col" className="py-2 pr-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.checks.map((row, index) => (
                      <tr key={`${row.receiptNumber}-${index}`} className="border-input border-b">
                        <td className="py-2 pr-4 tabular-nums">{row.receiptNumber ?? '—'}</td>
                        <td className="py-2 pr-4">{row.tenantName}</td>
                        <td className="py-2 pr-4">{row.checkNumber ?? '—'}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="close-heading" className="flex flex-col gap-3 print:hidden">
            <h2 id="close-heading" className="font-medium">
              Count down and close
            </h2>
            <p className="text-muted-foreground max-w-prose text-xs text-pretty">
              Count the drawer before looking at the expected figure above — a count taken after
              reading the target is not a count. Anything out by more than{' '}
              {formatCents(view.thresholdCents)} needs a note explaining it.
            </p>
            <AdminForm action={closeDrawerAction} label="Close the drawer" className="flex flex-col gap-3">
              <input type="hidden" name="sessionId" value={view.sessionId} />
              <div className="flex flex-wrap items-end gap-3">
                <Field name="countedCash" label="Counted cash ($)" inputMode="decimal" required />
                <Field name="countedChecks" label="Counted cheques ($)" inputMode="decimal" required defaultValue="0.00" />
              </div>
              <Field
                name="note"
                label="Note"
                className="flex flex-col gap-1 text-sm"
                hint="Required only if the drawer is out by more than the threshold."
              />
              <Button type="submit" className="self-start">
                Close drawer
              </Button>
            </AdminForm>
          </section>
        </>
      )}
    </div>
  )
}
