import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { autopayLeases, savedMethods } from '@/lib/portal/payment-methods'
import { nextBillingDate } from '@/lib/portal/dashboard'
import { listParts } from '@storage/core/pricing'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import { AdminForm } from '@/components/admin/form'
import { removeMethodAction, setAutopayAction, setDefaultMethodAction } from './actions'

export const metadata: Metadata = { title: 'Payment methods' }

// PRD 01 §4.7 US-704. Cards on file, which unit charges itself, and what the
// next charge will be.
//
// Changing any of this re-verifies who you are first (US-701) — actions.ts
// owns that gate, including why turning autopay OFF is deliberately not gated.

function formatCard(brand: string): string {
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

export default async function PaymentMethodsPage() {
  const actor = await requireTenantActor()
  const [methods, leases] = await Promise.all([
    savedMethods(actor.tenantId),
    autopayLeases(actor.tenantId),
  ])
  const hasMethod = Boolean(methods && methods.length > 0)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Payment methods</h1>

      <section aria-labelledby="cards-heading" className="flex flex-col gap-3">
        <h2 id="cards-heading" className="font-medium">
          Cards on file
        </h2>

        {methods === null ? (
          // Distinct from "no cards": we could not ask, so we do not claim.
          <p className="border-input rounded-lg border p-4 text-sm text-pretty">
            We can&apos;t show your saved cards just now. Call{' '}
            <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
              {SITE.phone.display}
            </a>{' '}
            and we can help.
          </p>
        ) : methods.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            You don&apos;t have a card saved yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {methods.map((method) => (
              <li key={method.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {formatCard(method.brand)} ending {method.last4}
                    {method.isDefault && (
                      <span className="text-muted-foreground ml-2 font-normal">
                        · charged for automatic payments
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    Expires {String(method.expMonth).padStart(2, '0')}/{method.expYear}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!method.isDefault && (
                    <AdminForm
                      action={setDefaultMethodAction}
                      label={`Use the card ending ${method.last4} for automatic payments`}
                    >
                      <input type="hidden" name="methodId" value={method.id} />
                      <button
                        type="submit"
                        className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                      >
                        Use this card
                      </button>
                    </AdminForm>
                  )}
                  <AdminForm
                    action={removeMethodAction}
                    label={`Remove the card ending ${method.last4}`}
                  >
                    <input type="hidden" name="methodId" value={method.id} />
                    <button
                      type="submit"
                      className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </AdminForm>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground text-sm text-pretty">
          To add a card, pay a balance with it and choose to keep it on file, or call{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="autopay-heading" className="flex flex-col gap-3">
        <h2 id="autopay-heading" className="font-medium">
          Automatic payments
        </h2>

        {leases.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            We don&apos;t see an active unit on this account.
          </p>
        ) : (
          leases.map((lease) => {
            const next = nextBillingDate(lease.billingDay, new Date())
            return (
              <div key={lease.leaseId} className="border-input rounded-lg border p-4">
                <p className="text-sm font-medium">
                  {lease.facilityName} — Unit {lease.unitNumber}
                </p>

                {/* §4.6: the amount and the date, next to the control that
                    turns it on — not behind a link. */}
                <p className="text-muted-foreground mt-1 text-sm text-pretty">
                  {lease.autopayEnabled ? (
                    <>
                      We charge <strong>{formatRate(lease.monthlyChargeCents)}</strong>{' '}
                      {/* B-227 / US-301. The figure states what it contains.
                          It was rent plus protection with the tax on rent
                          missing, so it was LOWER than what autopay actually
                          took — and this is the sentence a tenant screenshots
                          when the two do not match. */}
                      ({listParts(lease.chargeParts)}) on day {lease.billingDay} of each month —
                      next on{' '}
                      {new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(
                        next,
                      )}
                      . We email you two days before every charge.
                    </>
                  ) : (
                    <>
                      Off. {formatRate(lease.monthlyChargeCents)} ({listParts(lease.chargeParts)})
                      is due on day {lease.billingDay} of
                      each month and you pay it yourself.
                    </>
                  )}
                </p>

                {lease.autopayEnabled && !hasMethod && (
                  <p role="alert" className="mt-2 text-sm text-pretty text-red-800">
                    There&apos;s no card on file for this to charge, so nothing will be taken
                    automatically. Add a card, or turn this off so you get a reminder instead.
                  </p>
                )}

                <AdminForm
                  action={setAutopayAction}
                  label={`Automatic payments for unit ${lease.unitNumber}`}
                  className="mt-3"
                >
                  <input type="hidden" name="leaseId" value={lease.leaseId} />
                  <input type="hidden" name="enabled" value={lease.autopayEnabled ? 'no' : 'yes'} />
                  <button
                    type="submit"
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                  >
                    {lease.autopayEnabled ? 'Turn off automatic payments' : 'Turn on automatic payments'}
                  </button>
                </AdminForm>
              </div>
            )
          })
        )}
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  )
}
