import { AdminForm, Field } from '@/components/admin/form'
import { StripePayment } from './payment-element'
import { setAutopayAction } from '@/app/(public)/checkout/actions'
import { takeCounterMoveInAction } from '@/app/(public)/checkout/counter-actions'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import type { AmountDue, PaymentSetup } from '@/lib/checkout/payment'

// PRD 01 US-501 step 5 / §4.6, §6.9.

const COUNTER_FIELD_CLASS = 'flex flex-col gap-1 text-sm'

export function PaymentStep({
  token,
  due,
  payment,
  autopayOn,
  returnUrl,
  billingDay,
  counterTender = false,
}: {
  token: string
  due: AmountDue
  payment: PaymentSetup
  autopayOn: boolean
  returnUrl: string
  billingDay: number
  /// B-230. True when a signed-in staffer with `payments:take` at this
  /// facility is the one looking at the screen — the walk-in move-in, which
  /// `startWalkInMoveInAction` starts by handing staff into this very
  /// checkout. Until this the step's only tender was the Payment Element, so
  /// a walk-in with cash could not rent a unit at all.
  ///
  /// A prop rather than a lookup in here: this is a server component in a
  /// public route, and the page it renders in already resolves the actor.
  counterTender?: boolean
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
          {/* B-227. This paragraph was STATIC and always said "Autopay is on."
              A renter who unticked the box and pressed Save reloaded onto a
              page still asserting autopay was on and still naming the amount
              and the day. The opt-out worked; the disclosure lied about the
              result, which on this screen is a consent question rather than a
              copy nit — D-11a permits a default-on enrolment only with an
              ADJACENT, ACCURATE disclosure. `/portal/methods` already branched
              correctly and is the model. */}
          <p id="autopay-disclosure" className="text-muted-foreground mt-2 text-sm text-pretty">
            {autopayOn ? (
              <>
                Autopay is on. We will charge this card{' '}
                <strong>{formatRate(due.ongoingMonthlyCents)}</strong> on day {billingDay} of each
                month, and email you two days before every charge. You can turn it off here now, or
                any time from your account.
              </>
            ) : (
              <>
                Autopay is off. Nothing is charged automatically —{' '}
                <strong>{formatRate(due.ongoingMonthlyCents)}</strong> is due on day {billingDay} of
                each month and you pay it yourself. We will email you when each payment is due. You
                can turn it back on here, or any time from your account.
              </>
            )}
          </p>
          <button
            type="submit"
            className="border-input hover:bg-accent mt-3 inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            Save this choice
          </button>
          {/* B-227. There are two submit buttons on this step — this one and
              the card payment below — and a renter who unticks the box and goes
              straight to paying is enrolled in the thing they just declined.
              Said in words rather than solved with a self-submitting checkbox,
              because that would need JavaScript and this checkout works
              without it. */}
          <p className="text-muted-foreground mt-2 text-xs text-pretty">
            Changing the tick does nothing until you press Save this choice. Paying below without
            saving keeps the setting above as it now reads.
          </p>
        </AdminForm>
      </section>

      {/* B-230 / US-32. The counter's own tender, above the card form because
          it is the reason a staffer is on this screen at all: they started
          this checkout from the POS and the person in front of them is
          holding notes. Cash and check settle through `recordCounterPayment`
          — the same receipt series, drawer session, staff attribution and
          manager ceiling as any other counter payment — and a card still goes
          through the Element below, which is where it has to go.

          Only rendered for staff. The tenant's own browser sees the card form
          and nothing else, and the server action refuses anyone who is not
          staff regardless of what is on screen. */}
      {counterTender && (
        <section aria-labelledby="counter-heading" className="mt-6">
          <h2 id="counter-heading" className="font-medium">
            Take cash or a check
          </h2>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            Staff only. Records the payment, prints to today&apos;s deposit slip and finishes the
            move-in — the lease, the gate code and the welcome email all go out the same as they
            would online.
          </p>
          <AdminForm
            action={takeCounterMoveInAction}
            label="Take cash or a check for this move-in"
            className="mt-3 grid max-w-lg grid-cols-2 gap-3"
          >
            <input type="hidden" name="token" value={token} />
            <Field
              name="method"
              label="Method"
              as="select"
              defaultValue="cash"
              required
              className={COUNTER_FIELD_CLASS}
            >
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="money_order">Money order</option>
            </Field>
            {/* The amount is NOT a field. It is the total stated above, worked
                out server-side by the same `amountDueToday` the card charge
                uses — a typed figure here would be a move-in settled for
                whatever a staffer keyed, against a total the renter has just
                read. */}
            <Field
              name="tendered"
              label="Cash tendered ($)"
              inputMode="decimal"
              hint="Cash only — change is worked out for you."
              className={COUNTER_FIELD_CLASS}
            />
            <Field
              name="checkNumber"
              label="Check / money-order number"
              hint="Required for check and money order."
              className={`${COUNTER_FIELD_CLASS} col-span-2`}
            />
            <p className="col-span-2 text-sm">
              Taking {formatRate(due.totalDueTodayCents)} for this move-in.
            </p>
            <button
              type="submit"
              className="bg-primary text-primary-foreground col-span-2 inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
            >
              Take {formatRate(due.totalDueTodayCents)} and finish the move-in
            </button>
          </AdminForm>
        </section>
      )}

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
