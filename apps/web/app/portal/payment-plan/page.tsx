import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { paymentPlansForTenant } from '@/lib/portal/payment-plan'
import { formatRate } from '@/lib/format'

export const metadata: Metadata = { title: 'Payment plan' }

// PRD 01 §9 (B-090 part 3). "Delinquency self-cure UX beyond banner (payment
// plans)". Read-only — see the comment in lib/portal/payment-plan.ts for why.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

const STATUS_COPY: Record<string, string> = {
  active: 'Active',
  completed: 'Completed — thank you for keeping to it.',
  broken: 'Broken — an installment was missed, so collections have resumed.',
  cancelled: 'Cancelled',
}

export default async function PortalPaymentPlanPage() {
  const actor = await requireTenantActor()
  const plans = await paymentPlansForTenant(actor.tenantId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Payment plan</h1>
        {/* D-96 (B-188). "Paying keeps you on track" was true of the code and
            not of the plan: only money that goes to the overdue balance the
            plan was set up over moves these installments, so a tenant paying
            just this month's rent could read that sentence and believe they
            were current. The rule a tenant is held to has to be on the page
            they read before they pay (D-15 — their words, not ours). */}
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          What was agreed and what&apos;s left. Your plan covers the amount that was already overdue
          when it was set up — your regular rent is still due on its own date each month, on top of
          the payments below. This page updates itself as your payments come in.
        </p>
      </div>

      {plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">You&apos;re not on a payment plan right now.</p>
      ) : (
        plans.map((plan) => (
          <section key={plan.id} className="border-input flex flex-col gap-3 rounded-lg border p-4">
            <div>
              <h2 className="font-medium">
                {plan.facilityName} — Unit {plan.unitNumber}
              </h2>
              <p className="text-muted-foreground text-sm">
                {STATUS_COPY[plan.status] ?? plan.status} · {formatRate(plan.totalCents)} total
              </p>
            </div>

            <table className="w-full text-sm">
              <caption className="sr-only">
                Installment schedule for unit {plan.unitNumber}
              </caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-1 font-medium">
                    Due
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.installments.map((installment) => (
                  <tr key={installment.position} className="border-b last:border-0">
                    <td className="py-1">{formatDate(installment.dueDate)}</td>
                    <td className="py-1 text-right tabular-nums">{formatRate(installment.amountCents)}</td>
                    <td className="py-1 capitalize">
                      {installment.status === 'missed' ? (
                        <span className="font-medium text-red-800">Missed</span>
                      ) : (
                        installment.status
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {plan.status === 'active' && (
              <Link
                href={`/portal/pay?lease=${plan.leaseId}`}
                className="bg-primary text-primary-foreground inline-flex min-h-11 w-fit items-center justify-center rounded-md px-4 text-sm font-medium"
              >
                Make a payment
              </Link>
            )}
          </section>
        ))
      )}
    </div>
  )
}
