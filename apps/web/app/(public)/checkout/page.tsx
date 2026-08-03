import Link from 'next/link'
import { AdminForm } from '@/components/admin/form'
import { PriceSummary } from '@/components/checkout/price-summary'
import { Stepper } from '@/components/checkout/stepper'
import { SITE } from '@/lib/site-config'
import { prisma } from '@storage/db'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { LOCK_WARNING_MINUTES, sessionByToken } from '@/lib/checkout/session'
import { prefillFromReservation } from '@/lib/checkout/details'
import { DetailsStep } from '@/components/checkout/details-step'
import { UnitStep } from '@/components/checkout/unit-step'
import { ProtectionStep } from '@/components/checkout/protection-step'
import { LeaseStep } from '@/components/checkout/lease-step'
import { PaymentStep } from '@/components/checkout/payment-step'
import { amountDueToday, preparePayment } from '@/lib/checkout/payment'
import { currentPlans, defaultTier } from '@/lib/protection/plans'
import { buildLeaseDocument, existingLeaseDocument } from '@/lib/lease/build'
import { renderTemplate } from '@/lib/documents/render'
import { LEASE_SUMMARY_TEMPLATE } from '@/lib/lease/template'
import { leaseValuesFor } from '@/lib/lease/build'
import { leaseIdForSession } from '@/lib/checkout/provision'
import { codeForLease } from '@/lib/access/provision'
import {
  directionsUrl,
  facilityPath,
  formatAddress,
  formatTimeOfDay,
  publicFacilityBySlug,
  type PublicFacility,
} from '@/lib/facility/public-facility'
import type { DayOfWeek } from '@storage/core/facility-settings'
import { advanceAction, extendLockAction, relockAction } from './actions'

export const metadata = {
  title: 'Move in online',
  robots: { index: false, follow: false },
}

// PRD 01 FR-4.1. The stepper shell.
//
// This item owns the machine — the session, the lock, the progress indicator
// and the price summary. The CONTENT of each step is its own backlog item
// (B-021 details, B-022 protection, B-024 lease, B-025 payment), so each step
// here renders its heading, the summary, and a continue control. That is not a
// placeholder for its own sake: it makes the state machine, the lock warning
// and the unit-lost fallback exercisable end to end before any step has a form.

function minutesLeft(lockExpiresAt: Date): number {
  return Math.max(0, Math.round((lockExpiresAt.getTime() - Date.now()) / 60_000))
}

/// The confirmation page's one line of hours: what matters right now, to
/// someone about to drive to the unit they just paid for — not the full
/// weekly table the facility page shows.
function todaysGateHours(facility: PublicFacility): string {
  if (!facility.gateHours) return 'Gate hours: call to confirm before you head over.'
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: facility.timezone,
  })
    .format(new Date())
    .toLowerCase() as DayOfWeek
  const today = facility.gateHours[weekday]
  if (today.closed) return 'The gate is closed today.'
  return `Gate hours today: ${formatTimeOfDay(today.open)}–${formatTimeOfDay(today.close)}.`
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const session = token ? await sessionByToken(token) : null

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          We couldn&apos;t find that checkout
        </h1>
        <p className="mt-4 text-pretty">
          The link may have expired. Nothing has been charged, and nothing is being held for you.
        </p>
        <p className="mt-4">
          <Link href="/storage/search" className="underline underline-offset-4">
            Find a unit
          </Link>{' '}
          <span className="text-muted-foreground">
            or call{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              {SITE.phone.display}
            </a>
            .
          </span>
        </p>
      </div>
    )
  }

  // The session stores a facility id; the public reads are keyed by slug,
  // because the slug is the public identifier everywhere else.
  const facility = await prisma.facility.findUnique({
    where: { id: session.facilityId },
    select: { slug: true },
  })
  const inventory = facility ? await publicInventoryForFacility(facility.slug) : null
  const unitType = inventory?.unitTypes.find((type) => type.unitTypeId === session.unitTypeId)

  // US-501: arriving from a reservation pre-fills everything already known.
  const reservation = await prisma.checkoutSession.findUnique({
    where: { id: session.id },
    select: { reservationId: true, unit: { select: { number: true } } },
  })
  const prefill = await prefillFromReservation(reservation?.reservationId ?? null)

  const plans = session.step === 'insurance' ? await currentPlans(session.facilityId) : []
  const facilityPolicy = await prisma.facility.findUnique({
    where: { id: session.facilityId },
    select: { protectionRequired: true },
  })

  // The lease is built once and reused. Re-rendering on every page view would
  // move the hash under a signer part-way through the step.
  let lease: { summaryHtml: string; leaseHtml: string } | null = null
  if (session.step === 'lease') {
    const existing = await existingLeaseDocument(session.id)
    if (existing?.content) {
      lease = {
        // The stored document is a complete HTML document; only its body can be
        // embedded in this page. See renderDocument's note.
        leaseHtml: existing.content.replace(/^[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*$/, ''),
        summaryHtml: renderTemplate(LEASE_SUMMARY_TEMPLATE, await leaseValuesFor(session)),
      }
    } else {
      const built = await buildLeaseDocument(session)
      lease = { leaseHtml: built.html, summaryHtml: built.summaryHtml }
    }
  }

  const payment = session.step === 'payment' ? await preparePayment(session) : null
  const due = session.step === 'payment' ? await amountDueToday(session) : null

  // US-501 step 7: code, address, hours. `code` is null whenever there is
  // nothing to reveal yet (no encryption key configured, or the synchronous
  // issuance from the payment webhook hasn't landed) — the page falls back to
  // "texted within 15 minutes" either way rather than distinguishing why.
  let confirmationCode: string | null = null
  let confirmationFacility = null
  if (session.step === 'provisioned') {
    const leaseId = await leaseIdForSession(session.id)
    confirmationCode = leaseId ? await codeForLease(leaseId) : null
    confirmationFacility = facility ? await publicFacilityBySlug(facility.slug) : null
  }

  const remaining = minutesLeft(session.lockExpiresAt)
  const warning = !session.lockLapsed && remaining <= LOCK_WARNING_MINUTES

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">Move in online</h1>

      <div className="mt-6">
        <Stepper current={session.step} />
      </div>

      {/* FR-4.1's unit-lost fallback. The renter keeps every answer they have
          given; only the unit changes. */}
      {session.lockLapsed && (
        <section aria-labelledby="lost" className="border-input mt-6 rounded-lg border p-4">
          <h2 id="lost" className="text-xl font-medium">
            We couldn&apos;t keep that unit
          </h2>
          <p className="mt-2 text-pretty">
            We hold a unit for 30 minutes while you move in, and that time ran out.{' '}
            <strong>Nothing has been charged.</strong> Everything you have entered is still here — we
            just need to put you on another unit the same size.
          </p>
          <AdminForm action={relockAction} label="Find me another unit" className="mt-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
            >
              Find me another unit the same size
            </button>
          </AdminForm>
        </section>
      )}

      {/* 2.2.1 Timing Adjustable: warned before it lapses, with an extension
          that is one activation away. The control exists rather than relying on
          a background heartbeat, because a screen-reader user reading a long
          lease generates no interaction events and an idle-based timer would
          drop precisely them. */}
      {warning && (
        <section aria-labelledby="lock" className="border-input mt-6 rounded-lg border p-4">
          <h2 id="lock" className="text-base font-medium">
            Still there?
          </h2>
          <p role="status" className="mt-1 text-sm text-pretty">
            We are holding your unit for another {remaining}{' '}
            {remaining === 1 ? 'minute' : 'minutes'}. Nothing has been charged, and you can keep it
            for longer.
          </p>
          <AdminForm action={extendLockAction} label="Keep holding my unit" className="mt-3">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
            >
              Keep it for another 30 minutes
            </button>
          </AdminForm>
        </section>
      )}

      {!session.lockLapsed && (
        <section aria-labelledby="step" className="mt-8">
          {/* Each step's own form arrives with its item; what this owns is that
              the heading exists, is focusable, and names where the renter is. */}
          <h2 id="step" tabIndex={-1} className="text-xl font-medium">
            {session.step === 'details' && 'Your details'}
            {session.step === 'unit_assign' && 'Your unit'}
            {session.step === 'insurance' && 'Protect what you store'}
            {session.step === 'lease' && 'Your lease'}
            {session.step === 'payment' && 'Payment'}
            {session.step === 'provisioned' && 'You are moved in'}
          </h2>

          {/* Session data wins over the reservation prefill: if the renter has
              already corrected something on this step, their correction is what
              comes back when they return to it. */}
          {session.step === 'details' && (
            <DetailsStep
              token={token!}
              prefill={{ ...prefill, ...(session.data as Partial<typeof prefill>) }}
            />
          )}

          {session.step === 'unit_assign' && unitType && (
            <UnitStep
              token={token!}
              unitNumber={reservation?.unit?.number ?? null}
              unitLabel={`${unitType.widthFt} foot by ${unitType.lengthFt} foot ${unitType.name}`}
              facilityName={inventory!.facility.name}
              quotedRateCents={session.quotedRateCents}
              moveInDate={new Intl.DateTimeFormat('en-US', {
                dateStyle: 'full',
                timeZone: inventory!.facility.timezone,
              }).format(new Date())}
            />
          )}

          {session.step === 'insurance' && (
            <ProtectionStep
              token={token!}
              plans={plans}
              defaultTier={defaultTier(plans)}
              required={facilityPolicy?.protectionRequired ?? true}
            />
          )}

          {session.step === 'lease' && lease && (
            <LeaseStep
              token={token!}
              summaryHtml={lease.summaryHtml}
              leaseHtml={lease.leaseHtml}
              legalName={`${(session.data as Record<string, string>).firstName ?? ''} ${
                (session.data as Record<string, string>).lastName ?? ''
              }`.trim()}
            />
          )}

          {session.step === 'payment' && payment && due && (
            <PaymentStep
              token={token!}
              due={due}
              payment={payment}
              autopayOn={session.data.autopay !== false}
              returnUrl={`${process.env.AUTH_URL ?? 'http://localhost:3000'}/checkout?token=${encodeURIComponent(token!)}`}
              billingDay={1}
            />
          )}

          {session.step === 'provisioned' && (
            <div className="mt-4">
              <p className="text-pretty">
                Your unit is yours. We have emailed your lease and receipt to{' '}
                <strong>{session.email}</strong>.
              </p>

              {/* US-501 step 7. `confirmationCode` is null whenever there is
                  nothing to reveal yet (no encryption key configured, or
                  issuance hasn't landed) — the fallback says what is true
                  rather than showing a placeholder that looks like a code. */}
              {confirmationCode ? (
                <div className="border-input mt-4 rounded-lg border p-4">
                  <p className="text-muted-foreground text-sm">Your gate code</p>
                  <p className="mt-1 text-4xl font-semibold tracking-widest tabular-nums select-all">
                    {confirmationCode}
                  </p>
                  {reservation?.unit?.number && (
                    <p className="text-muted-foreground mt-2 text-sm">
                      Unit {reservation.unit.number}
                    </p>
                  )}
                </div>
              ) : (
                <p className="border-input mt-4 rounded-lg border p-4 text-pretty">
                  Your gate code will be texted to you within 15 minutes. If it has not arrived,
                  call{' '}
                  <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
                    {SITE.phone.display}
                  </a>{' '}
                  and we will read it to you — you can move in either way.
                </p>
              )}

              {confirmationFacility && (
                <div className="mt-4 text-sm text-pretty">
                  <address className="not-italic">{formatAddress(confirmationFacility)}</address>
                  <p className="mt-1">{todaysGateHours(confirmationFacility)}</p>
                  <p className="mt-1">
                    <a
                      href={directionsUrl(confirmationFacility)}
                      className="underline underline-offset-4"
                    >
                      Get directions
                    </a>{' '}
                    ·{' '}
                    <Link
                      href={facilityPath(confirmationFacility)}
                      className="underline underline-offset-4"
                    >
                      Facility hours &amp; details
                    </Link>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Nothing below provisioned. Until then the machine still
              has to be walkable end to end, so they keep the plain continue. */}
          {!['details', 'unit_assign', 'insurance', 'lease', 'payment', 'provisioned'].includes(
            session.step,
          ) && (
            <AdminForm action={advanceAction} label="Continue" className="mt-4">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="from" value={session.step} />
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
              >
                Continue
              </button>
            </AdminForm>
          )}
        </section>
      )}

      {unitType && (
        <div className="mt-8">
          <PriceSummary
            unitLabel={`${unitType.widthFt} foot by ${unitType.lengthFt} foot ${unitType.name}`}
            facilityName={inventory!.facility.name}
            webRateCents={session.quotedRateCents}
            protectionPremiumCents={
              typeof session.data.protectionPremiumCents === 'number'
                ? session.data.protectionPremiumCents
                : undefined
            }
            streetRateCents={unitType.streetRateCents}
            adminFeeCents={inventory!.pricing.adminFeeCents}
            taxRates={inventory!.pricing.taxRates}
          />
        </div>
      )}
    </div>
  )
}
