import { AdminForm } from '@/components/admin/form'
import { StripePayment } from './payment-element'
import { setAutopayAction } from '@/app/(public)/checkout/actions'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import type { AmountDue, PaymentSetup } from '@/lib/checkout/payment'

// PRD 01 US-501 step 5 / §4.6, §6.9.

export function PaymentStep({
  token,
  due,
  payment,
  autopayOn,
  returnUrl,
  billingDay,
}: {
  token: string
  due: AmountDue
  payment: PaymentSetup
  autopayOn: boolean
  returnUrl: string
  billingDay: number
}) {
  return (
    <div className="mt-4">
      {/* 3.3.4 Error Prevention (Financial): everything being charged, itemised
          and reviewable, before the act that charges it. A <dl>, so each amount
          announces with the thing it is for rather than as a loose number. */}
      <section aria-labelledby="due-heading" className="border-input rounded-lg border p-4">
        <h2 id="due-heading" className="font-medium">
          What you are paying today
        </h2>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          {due.lines.map((line) => (
            <div key={line.key} className="flex justify-between gap-4">
              <dt>{line.label}</dt>
              <dd className="tabular-nums">{formatRate(line.amountCents)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t pt-2 text-base font-medium">
            <dt>Total due today</dt>
            <dd className="tabular-nums">{formatRate(due.totalDueTodayCents)}</dd>
          </div>
          <div className="text-muted-foreground flex justify-between gap-4">
            <dt>Then each month</dt>
            <dd className="tabular-nums">{formatRate(due.ongoingMonthlyCents)}/mo</dd>
          </div>
        </dl>
      </section>

      {/* §6.9 / D-11a. Autopay is default-on, so the disclosure is adjacent and
          not behind a link, the amount and the date are stated, and turning it
          off is one activation in the same tab sequence — not a settings page
          the renter has to find later. */}
      <section aria-labelledby="autopay-heading" className="mt-6">
        <h2 id="autopay-heading" className="font-medium">
          Automatic payments
        </h2>
        <AdminForm action={setAutopayAction} label="Automatic payments" className="mt-2">
          <input type="hidden" name="token" value={token} />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="autopay"
              value="yes"
              defaultChecked={autopayOn}
              aria-describedby="autopay-disclosure"
              className="mt-1"
            />
            <span>Pay automatically each month</span>
          </label>
          <p id="autopay-disclosure" className="text-muted-foreground mt-2 text-sm text-pretty">
            Autopay is on. We will charge this card{' '}
            <strong>{formatRate(due.ongoingMonthlyCents)}</strong> on day {billingDay} of each
            month, and email you two days before every charge. You can turn it off here now, or any
            time from your account.
          </p>
          <button
            type="submit"
            className="border-input hover:bg-accent mt-3 inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            Save this choice
          </button>
        </AdminForm>
      </section>

      <section aria-labelledby="pay-heading" className="mt-6">
        <h2 id="pay-heading" className="font-medium">
          Card details
        </h2>
        {payment.available ? (
          <StripePayment clientSecret={payment.clientSecret} returnUrl={returnUrl} />
        ) : (
          // The honest failure. A form that cannot submit is worse than a
          // sentence that ends in a rented unit.
          <p className="border-input mt-3 rounded-lg border p-4 text-pretty">
            We can&apos;t take card payments online just now.{' '}
            <a
              href={`tel:${SITE.phone.href}`}
              className="font-medium underline underline-offset-4"
            >
              Call {SITE.phone.display}
            </a>{' '}
            and we will take payment over the phone and finish your move-in. Your unit stays held in
            the meantime.
          </p>
        )}
      </section>
    </div>
  )
}
