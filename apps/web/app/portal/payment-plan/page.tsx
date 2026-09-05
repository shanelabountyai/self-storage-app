import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { paymentPlansForTenant } from '@/lib/portal/payment-plan'
import { formatCalendarDate, formatRate } from '@/lib/format'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'plan.title') }
}

// PRD 01 §9 (B-090 part 3). "Delinquency self-cure UX beyond banner (payment
// plans)". Read-only — see the comment in lib/portal/payment-plan.ts for why.

// B-228. `plan.createdAt` is a real INSTANT (`@default(now())`), which is why
// it is not `formatCalendarDate` — the installment dates below are, and mixing
// the two through one helper is how this page and the dashboard ended up
// naming different days for the same installment. A facility timezone would be
// the right thing to render this in; `paymentPlansForTenant` does not carry
// one, so it stays as it was and is left to whoever needs it.
function formatAgreedOn(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

// B-193. Every plan is shown now, live or not, so each one has to say what
// happened to it AND what that costs today — a tenant reading "Broken" wants
// to know what they now owe and what to do, not only that it ended. All of it
// is words: nothing on this page is carried by colour (WCAG 1.4.1 A), and the
// language is the tenant's, not the ledger's (D-15).
const STATUS_KEYS: Record<string, MessageKey> = {
  active: 'plan.status.active',
  completed: 'plan.status.completed',
  broken: 'plan.status.broken',
  cancelled: 'plan.status.cancelled',
}

/// The one-word installment states. Only the three the schedule can render;
/// `missed` and `late` are handled in the cell, which needs a date with them.
const INSTALLMENT_STATUS_KEYS: Record<string, MessageKey> = {
  paid: 'plan.status.paid',
  due: 'plan.status.due',
  upcoming: 'plan.status.upcoming',
}

export default async function PortalPaymentPlanPage() {
  const actor = await requireTenantActor()
  const plans = await paymentPlansForTenant(actor.tenantId)
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t('plan.title')}</h1>
        {/* D-96 (B-188). "Paying keeps you on track" was true of the code and
            not of the plan: only money that goes to the overdue balance the
            plan was set up over moves these installments, so a tenant paying
            just this month's rent could read that sentence and believe they
            were current. The rule a tenant is held to has to be on the page
            they read before they pay (D-15 — their words, not ours). */}
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          {t('plan.intro')}
        </p>
      </div>

      {plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('plan.none')}</p>
      ) : (
        plans.map((plan) => {
          // The installment to pay next: the first one not yet covered, which
          // is a missed one where there is one. That is the figure the plan
          // exists to replace, and until B-193 the button below asked for the
          // whole arrears instead.
          const due = plan.installments.find((installment) => installment.status !== 'paid')
          return (
            <section key={plan.id} className="border-input flex flex-col gap-3 rounded-lg border p-4">
              <div>
                <h2 className="font-medium">
                  {t('plan.heading', {
                    facility: plan.facilityName,
                    unit: plan.unitNumber,
                    agreed: formatAgreedOn(plan.createdAt),
                  })}
                </h2>
                <p className="text-sm text-pretty">
                  {STATUS_KEYS[plan.status] ? t(STATUS_KEYS[plan.status]) : plan.status}
                </p>
                {/* D-98 (B-190), tenant side. A replacement plan is agreed over
                    the arrears that were LEFT, so its own progress restarts at
                    zero — without this line the money the previous plan
                    collected is invisible and a chain of three reads as three
                    failures. */}
                <p className="text-muted-foreground text-sm">
                  {t('plan.paidOf', {
                    paid: formatRate(plan.collectedCents),
                    total: formatRate(plan.totalCents),
                  })}
                </p>
              </div>

              {/* B-189/D-97. Whether the tenant has to do anything on each date
                  is the first thing they need from this page, and it is now two
                  different answers. Stated per plan rather than in the intro,
                  because a tenant with two units can have one of each.
                  `autoCollectEffective` is deliberate: a plan agreed as
                  automatic against a card that has since been removed will not
                  collect, and telling someone their payment is taken care of
                  when it is not is how they end up in collections believing
                  they kept to the plan. */}
              {plan.status === 'active' && (
                <p className="max-w-prose text-sm text-pretty">
                  {plan.autoCollectEffective ? t('plan.autoCollect') : t('plan.selfPay')}
                </p>
              )}

              <table className="w-full text-sm">
                <caption className="sr-only">
                  {t('plan.caption', {
                    unit: plan.unitNumber,
                    agreed: formatAgreedOn(plan.createdAt),
                  })}
                </caption>
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className="py-1 font-medium">
                      {t('plan.colDue')}
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      {t('plan.colAmount')}
                    </th>
                    {/* B-192. What a tenant reads a schedule for is "how much is
                        left after this one", and the subtraction was left to
                        them. Same column as the staff schedule, so the two
                        never disagree over the phone. */}
                    <th scope="col" className="py-1 text-right font-medium">
                      {t('plan.colLeftAfter')}
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      {t('plan.colStatus')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.installments.map((installment, index) => (
                    <tr key={installment.position} className="border-b last:border-0">
                      <td className="py-1">{formatCalendarDate(installment.dueDate)}</td>
                      <td className="py-1 text-right tabular-nums">{formatRate(installment.amountCents)}</td>
                      <td className="py-1 text-right tabular-nums">
                        {formatRate(
                          plan.totalCents -
                            plan.installments
                              .slice(0, index + 1)
                              .reduce((sum, i) => sum + i.amountCents, 0),
                        )}
                      </td>
                      {/* B-210. A payment inside D-98's grace is LATE, not
                          missed — the plan is still alive, and the deadline is
                          the only thing the tenant can act on. Said in words
                          with the date in them (1.4.1 A): "Missed" in red on a
                          plan that has not broken is both frightening and
                          false. */}
                      <td className="py-1 capitalize">
                        {installment.status === 'missed' ? (
                          <span className="font-medium text-red-800">{t('plan.missed')}</span>
                        ) : installment.status === 'late' ? (
                          <span className="font-medium normal-case">
                            {t('plan.lateBy', {
                              date: formatCalendarDate(installment.graceEndsOn),
                            })}
                          </span>
                        ) : INSTALLMENT_STATUS_KEYS[installment.status] ? (
                          t(INSTALLMENT_STATUS_KEYS[installment.status])
                        ) : (
                          installment.status
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* B-193. The pay link used to carry no amount, and /portal/pay
                  defaults to the WHOLE balance — so a tenant tapping through
                  from an installment schedule was quoted the arrears the plan
                  exists to replace. Both amounts are offered and both are
                  labelled with the figure, because either can be the right one
                  and neither should be a guess. */}
              {plan.status === 'active' && due && (
                <div className="flex flex-wrap items-center gap-4">
                  <Link
                    href={`/portal/pay?lease=${plan.leaseId}&amount=${due.amountCents / 100}`}
                    className="bg-primary text-primary-foreground inline-flex min-h-11 w-fit items-center justify-center rounded-md px-4 text-sm font-medium"
                  >
                    {t('plan.payDue', {
                      amount: formatRate(due.amountCents),
                      date: formatCalendarDate(due.dueDate),
                    })}
                  </Link>
                  <Link
                    href={`/portal/pay?lease=${plan.leaseId}`}
                    className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                  >
                    {t('plan.payWholeInstead')}
                  </Link>
                </div>
              )}
              {(plan.status === 'broken' || plan.status === 'cancelled') && (
                <Link
                  href={`/portal/pay?lease=${plan.leaseId}`}
                  className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4"
                >
                  {t('plan.payBalance')}
                </Link>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
