import Link from 'next/link'
import { requireStaffActor } from '@/lib/rbac/session'
import { chargeableLease, startCounterCardPayment } from '@/lib/admin/pos'
import { savedMethods } from '@/lib/portal/payment-methods'
import { AdminForm, Field } from '@/components/admin/form'
import { PortalPayment } from '@/components/portal/portal-payment'
import { formatCents } from '@/lib/format'
import { chargeCardOnFileAction } from './actions'

export const metadata = { title: 'Take a card payment' }

// PRD 02 §4.8 US-32 / PRD 01 US-601 (B-230). Card at the counter.
//
// One screen, two controls, because they are the two things that happen when
// somebody at the desk says "card": they hand one over, or they say "use the
// one you have". Reached from the POS payment form (choosing Card) and from
// each lease on the tenant profile, which carried no payment control at all.
//
// Keyed by LEASE, not by tenant plus the admin facility switcher. The tenant
// profile lists leases across every facility a staffer can see, and a charge
// raised against the switcher's facility rather than the lease's would be
// money posted to the wrong deposit — `chargeableLease` derives the facility
// from the lease and checks access against that.

/// Dollars as typed to integer cents, without floating point — the same parse
/// as `takePaymentAction`'s, for the same reason: `Math.round(parseFloat * 100)`
/// turns 16.10 into 1609.999… on some inputs.
function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [dollars, fraction = ''] = cleaned.split('.')
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

export default async function CounterCardPage({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string; amount?: string }>
}) {
  const { lease: leaseId, amount } = await searchParams
  const actor = await requireStaffActor()

  const lease = leaseId ? await chargeableLease(actor, leaseId) : null
  if (!lease) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Take a card payment</h1>
        <p className="text-sm text-pretty">
          We couldn&apos;t find a live lease to take a payment for. Find the tenant on the POS
          screen and start again.
        </p>
        <Link href="/admin/pos" className="text-sm underline underline-offset-2">
          Back to POS
        </Link>
      </div>
    )
  }

  // The requested amount, or the whole balance — which is what "they want to
  // pay their bill" means and what both entry points link with. A figure that
  // will not parse falls back to the balance and says so, rather than raising
  // an intent for a number nobody typed.
  const requested = amount ? parseDollars(amount) : null
  const amountCents = requested && requested > 0 ? requested : Math.max(lease.balanceCents, 0)

  // Nothing to charge. Worth its own branch: a $0 PaymentIntent throws inside
  // `createChargeIntent`, and the honest answer here is a sentence rather than
  // an error page in front of somebody at the desk.
  if (amountCents <= 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Take a card payment</h1>
        <p className="text-sm text-pretty">
          {lease.tenantName} owes nothing on unit {lease.unitNumber} right now — there is nothing to
          charge.
        </p>
        <Link href="/admin/pos" className="text-sm underline underline-offset-2">
          Back to POS
        </Link>
      </div>
    )
  }

  const [setup, methods] = await Promise.all([
    startCounterCardPayment(actor, lease, amountCents),
    savedMethods(lease.tenantId),
  ])
  const defaultMethod = methods?.find((method) => method.isDefault) ?? null

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Take a card payment</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {lease.tenantName} — unit {lease.unitNumber}
        </p>
      </div>

      {/* 3.3.4 Error Prevention (Financial): what is being charged, stated
          before either control that charges it. The staffer reads this figure
          out loud, so it is the one thing on the screen that has to be
          unambiguous. */}
      <dl className="border-input rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt>Balance on this unit</dt>
          <dd className="tabular-nums">{formatCents(lease.balanceCents)}</dd>
        </div>
        <div className="mt-2 flex justify-between gap-4 border-t pt-2 text-base font-medium">
          <dt>Charging today</dt>
          <dd className="tabular-nums">{formatCents(amountCents)}</dd>
        </div>
      </dl>

      {amount && requested === null && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm text-pretty">
          We couldn&apos;t read &ldquo;{amount}&rdquo; as an amount, so this is set to the whole
          balance. Change it below if that is wrong.
        </p>
      )}

      <details className="border-input rounded-lg border p-4" open={Boolean(amount) && requested === null}>
        <summary className="cursor-pointer text-sm font-medium">Charge a different amount</summary>
        {/* A GET form, so the whole screen works without JavaScript up to the
            Element itself — which is Stripe's and needs it by nature. */}
        <form method="GET" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="lease" value={lease.leaseId} />
          <label htmlFor="amount" className="flex flex-col gap-1 text-sm">
            Amount ($)
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={(amountCents / 100).toFixed(2)}
              className="border-input bg-background h-9 max-w-full min-w-0 rounded-md border px-2"
            />
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            Update amount
          </button>
        </form>
      </details>

      <section aria-labelledby="present-heading" className="flex flex-col gap-2">
        <h2 id="present-heading" className="font-medium">
          Card the tenant is holding
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          Turn the screen to them and let them enter it. Never type a card number in yourself —
          these details go straight to our payment processor and never reach us.
        </p>
        {setup.available ? (
          <PortalPayment
            clientSecret={setup.clientSecret}
            customerSessionSecret={setup.customerSessionSecret}
            returnUrl={`${process.env.AUTH_URL ?? 'http://localhost:3000'}/admin/pos/card/done?payment=${setup.paymentId}&lease=${lease.leaseId}`}
            amountLabel={formatCents(amountCents)}
          />
        ) : (
          <p className="border-input rounded-lg border p-4 text-sm text-pretty">
            Card payments are not configured right now.{' '}
            <Link href="/admin/pos" className="font-medium underline underline-offset-2">
              Take cash or a check on the POS screen
            </Link>{' '}
            instead.
          </p>
        )}
      </section>

      <section aria-labelledby="on-file-heading" className="flex flex-col gap-2">
        <h2 id="on-file-heading" className="font-medium">
          Card on file
        </h2>
        {defaultMethod ? (
          <>
            <p className="text-sm text-pretty">
              {/* Named, not "the card on file". A tenant with two cards needs
                  to hear which one is about to be charged before agreeing. */}
              <span className="capitalize">{defaultMethod.brand}</span> ending {defaultMethod.last4},
              expiring {String(defaultMethod.expMonth).padStart(2, '0')}/{defaultMethod.expYear}.
            </p>
            <AdminForm
              action={chargeCardOnFileAction}
              label="Charge the card on file"
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="leaseId" value={lease.leaseId} />
              <input type="hidden" name="amountCents" value={amountCents} />
              {/* Not a `<Field>`: there is nothing to type. The hidden amount
                  above is the figure stated in the summary at the top of the
                  screen, and `chargeCardOnFileAction` re-reads the balance it
                  is checked against from the ledger rather than trusting it. */}
              <Field
                name="confirm"
                as="checkbox"
                required
                value="yes"
                label={`The tenant has asked us to charge ${formatCents(amountCents)} to this card`}
                hint="Nobody is presenting the card, so this is the record that they agreed to it."
              />
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
              >
                Charge {formatCents(amountCents)} to the card on file
              </button>
            </AdminForm>
          </>
        ) : (
          <p className="text-muted-foreground text-sm text-pretty">
            {methods === null
              ? 'We can’t reach the thing that knows which cards are on file.'
              : 'No card on file for this tenant.'}{' '}
            Use the form above, or take cash or a check on the POS screen.
          </p>
        )}
      </section>

      <Link href="/admin/pos" className="text-sm underline underline-offset-2">
        Back to POS
      </Link>
    </div>
  )
}
