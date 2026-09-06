import { LocaleLink } from '@/components/site/locale-link'
import { AdminForm } from '@/components/admin/form'
import { PriceSummary } from '@/components/checkout/price-summary'
import { CheckoutAnnouncer } from '@/components/checkout/announcer'
import { LockWarning } from '@/components/checkout/lock-warning'
import { BackControl } from '@/components/checkout/back-control'
import { labelForStep, stepAnnouncement, Stepper } from '@/components/checkout/stepper'
import { SITE } from '@/lib/site-config'
import { formatCalendarDate, formatCents, formatRate } from '@/lib/format'
import { prisma } from '@storage/db'
import { billingDayFor } from '@storage/core/billing'
import { isoDate, startDateWindow } from '@storage/core/checkout'
import { businessDateFor } from '@storage/core/jobs'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import {
  LOCK_WARNING_MINUTES,
  STEPS,
  alternativeSizes,
  promoDiscountOn,
  sessionByToken,
} from '@/lib/checkout/session'
import { CallLink, phoneFor } from '@/components/marketing/call-link'
import { WaitlistForm } from '@/components/marketing/waitlist-form'
import { joinWaitlistAction } from '../storage/[state]/[city]/[slug]/waitlist-actions'
import { prefillFromReservation } from '@/lib/checkout/details'
import { currentActor } from '@/lib/rbac/session'
import { can } from '@/lib/rbac/authorize'
import { localityForZip } from '@/lib/geo/geocode'
import { DetailsStep } from '@/components/checkout/details-step'
import { UnitStep } from '@/components/checkout/unit-step'
import { ProtectionStep } from '@/components/checkout/protection-step'
import { LeaseStep } from '@/components/checkout/lease-step'
import { PaymentStep } from '@/components/checkout/payment-step'
import { amountDueToday, preparePayment } from '@/lib/checkout/payment'
import { currentPlans, defaultTier } from '@/lib/protection/plans'
import { buildLeaseDocuments, existingLeaseDocuments } from '@/lib/lease/build'
import { bodyOf, renderTemplate } from '@/lib/documents/render'
import { LEASE_SUMMARY_TEMPLATE } from '@/lib/lease/template'
import { leaseValuesFor } from '@/lib/lease/build'
import { leaseIdForSession } from '@/lib/checkout/provision'
import { nextChargeForLease } from '@/lib/portal/dashboard'
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
import { advanceAction, applyPromoCodeAction, relockAction, relockAtSizeAction } from './actions'
import { PromoCodeStep } from '@/components/checkout/promo-code-step'
import {
  dictionaryFor,
  translate,
  type Dictionary,
  type MessageKey,
} from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-090 part 6. `robots` is unchanged and is the reason the language never
// reaches a crawler here at all: checkout is noindex, so there is no SEO
// consequence to this page rendering in either language.
export async function generateMetadata() {
  const dict = dictionaryFor(await getLocale())
  return {
    title: translate(dict, 'checkout.title'),
    robots: { index: false, follow: false },
  }
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
function todaysGateHours(facility: PublicFacility, dict: Dictionary): string {
  if (!facility.gateHours) return translate(dict, 'checkout.gateHoursUnknown')
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: facility.timezone,
  })
    .format(new Date())
    .toLowerCase() as DayOfWeek
  const today = facility.gateHours[weekday]
  if (today.closed) return translate(dict, 'checkout.gateClosedToday')
  return translate(dict, 'checkout.gateHoursToday', {
    open: formatTimeOfDay(today.open),
    close: formatTimeOfDay(today.close),
  })
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const session = token ? await sessionByToken(token) : null
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {t('checkout.notFoundHeading')}
        </h1>
        <p className="mt-4 text-pretty">{t('checkout.notFoundBody')}</p>
        <p className="mt-4">
          <LocaleLink href="/storage/search" className="underline underline-offset-4">
            {t('checkout.findAUnit')}
          </LocaleLink>{' '}
          <span className="text-muted-foreground">
            {t('checkout.orCall')}{' '}
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
  // B-111: what they chose last time, if they have been here before. Back
  // navigation makes returning to a completed step ordinary, and §6.4's "going
  // forward re-asks nothing" means their answer, not our recommendation.
  const chosenProtection =
    typeof session.data.protection === 'string' ? session.data.protection : null
  const priorWaiver =
    session.step === 'insurance' && chosenProtection === 'waiver'
      ? await prisma.protectionWaiver.findUnique({
          where: { checkoutSessionId: session.id },
          select: { carrier: true, policyNumber: true, expiresAt: true },
        })
      : null
  const facilityPolicy = await prisma.facility.findUnique({
    where: { id: session.facilityId },
    select: {
      protectionRequired: true,
      billingPolicy: true,
      timezone: true,
      maxCheckoutStartDaysAhead: true,
    },
  })

  // D-53. One agreement per unit, signed by one action. Built once and reused:
  // re-rendering on every page view would move the hash under a signer
  // part-way through the step.
  let leases: { unitName: string; summaryHtml: string; leaseHtml: string }[] = []
  let signedOn: string | undefined
  if (session.step === 'lease') {
    const existing = await existingLeaseDocuments(session)
    // Fewer documents than lines means the renter added a unit after reaching
    // this step, so the set is rebuilt rather than part-rendered. `storeGenerated`
    // is keyed per line, so the units that already have one keep their hash.
    if (existing.length === session.units.length && existing.every((entry) => entry.document.content)) {
      // B-111: set only when the renter has come BACK to leases they already
      // signed. `signDocument` refuses a second signature, so without this the
      // step would offer a control that can only fail. One `signedAt` for the
      // set under D-53, so the first is the whole set's.
      const signature = existing[0].document.signature
      signedOn = signature
        ? new Intl.DateTimeFormat('en-US', {
            dateStyle: 'long',
            timeZone: facilityPolicy?.timezone ?? 'UTC',
          }).format(signature.signedAt)
        : undefined

      leases = await Promise.all(
        existing.map(async (entry) => {
          const line = session.units.find((candidate) => candidate.id === entry.lineId)
          const values = await leaseValuesFor(session, line)
          return {
            unitName: values.unitNumber,
            // The stored document is a complete HTML document; only its body
            // can be embedded in this page, and `bodyOf` drops the document's
            // own <h1> so a resumed lease step has the same heading outline as
            // a first visit. See renderDocument's note.
            leaseHtml: bodyOf(entry.document.content!),
            summaryHtml: renderTemplate(LEASE_SUMMARY_TEMPLATE, values),
          }
        }),
      )
    } else {
      leases = (await buildLeaseDocuments(session)).map((built) => ({
        unitName: built.unitName,
        leaseHtml: built.html,
        summaryHtml: built.summaryHtml,
      }))
    }
  }

  const payment = session.step === 'payment' ? await preparePayment(session) : null
  const due = session.step === 'payment' ? await amountDueToday(session) : null

  // B-230 / US-32. Whether to offer the counter's own tender on this step.
  //
  // `currentActor` rather than `requireStaffActor`: this is a public route and
  // an anonymous renter is the ordinary case, so "no actor" has to be an
  // answer rather than a refusal. Staff AND `payments:take` at THIS facility —
  // a staffer from another site helping with a link is not the person with a
  // drawer open here, and the server action re-checks both regardless of what
  // this renders.
  const viewer = session.step === 'payment' ? await currentActor() : null
  const counterTender =
    viewer?.kind === 'staff' && can(viewer, 'payments:take', session.facilityId)

  // US-501 step 7: code, address, hours. `code` is null whenever there is
  // nothing to reveal yet (no encryption key configured, or the synchronous
  // issuance from the payment webhook hasn't landed) — the page falls back to
  // "texted within 15 minutes" either way rather than distinguishing why.
  let confirmationCode: string | null = null
  let confirmationFacility = null
  // B-239 / US-601. The next charge, which this screen was required to restate
  // and did not — the welcome email carried it and the page did not.
  let nextCharge: Awaited<ReturnType<typeof nextChargeForLease>> = null
  if (session.step === 'provisioned') {
    const leaseId = await leaseIdForSession(session.id)
    confirmationCode = leaseId ? await codeForLease(leaseId) : null
    confirmationFacility = facility ? await publicFacilityBySlug(facility.slug) : null
    // Reckoned from TOMORROW, not from today. `nextBillingDate` returns today
    // when today is the billing day, which is what the dashboard wants and the
    // opposite of what this screen means: under anniversary billing the
    // billing day IS the move-in day, so "your next payment" would name the
    // charge the renter has just paid.
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    nextCharge = leaseId ? await nextChargeForLease(leaseId, tomorrow) : null
  }

  // B-106. The window the unit step's picker is bounded by, and the sentence
  // beside it. Computed here rather than in the component so the page and the
  // action judge the same window from the same facility setting.
  const startWindow = startDateWindow(
    isoDate(businessDateFor(new Date(), facilityPolicy?.timezone ?? 'America/Chicago')),
    facilityPolicy?.maxCheckoutStartDaysAhead ?? 0,
  )

  // B-106 part 5. The basket, resolved for display: a unit number per line
  // (only a claimed unit has one) and a size label from the facility's own
  // catalogue, so a line whose type differs from the session's still reads
  // correctly. One query for every number rather than one per line.
  const basketUnits = await prisma.unit.findMany({
    where: { id: { in: session.units.map((line) => line.unitId).filter((id) => id !== null) } },
    select: { id: true, number: true },
  })
  const numberByUnitId = new Map(basketUnits.map((unit) => [unit.id, unit.number]))
  const labelFor = (typeId: string) => {
    const type = inventory?.unitTypes.find((candidate) => candidate.unitTypeId === typeId)
    return type
      ? t('checkout.unitLabel', {
          width: type.widthFt,
          length: type.lengthFt,
          name: type.name,
        })
      : t('checkout.storageUnit')
  }
  const basketLines = session.units.map((line) => ({
    id: line.id,
    unitNumber: line.unitId ? (numberByUnitId.get(line.unitId) ?? null) : null,
    unitLabel: labelFor(line.unitTypeId),
    quotedRateCents: line.quotedRateCents,
  }))
  // Only sizes with something genuinely on the shelf. `availableCount` already
  // excludes units held by a live lock, so this cannot offer the renter a unit
  // another checkout is part-way through taking.
  const addableTypes = (inventory?.unitTypes ?? [])
    .filter((type) => type.availableCount > 0)
    .map((type) => ({
      unitTypeId: type.unitTypeId,
      label: `${type.widthFt} foot by ${type.lengthFt} foot ${type.name}`,
      webRateCents: type.webRateCents,
    }))

  // The same lines the summary prices. The street rate comes from the
  // catalogue rather than the basket — only the WEB rate is locked onto a line
  // (it is the one the renter is entitled to), and street is display-only:
  // `calculateMoveInCost` uses it for the strike-through saving and nothing
  // else. Falling back to the quoted rate means "no saving", never a fabricated
  // one, which is the rule `savingCents` already states.
  const summaryUnits = session.units.map((line, index) => {
    const type = inventory?.unitTypes.find(
      (candidate) => candidate.unitTypeId === line.unitTypeId,
    )
    const number = line.unitId ? numberByUnitId.get(line.unitId) : null
    return {
      id: line.id,
      name: number ? `Unit ${number}` : `Unit ${index + 1}`,
      label: labelFor(line.unitTypeId),
      rateCents: line.quotedRateCents,
      streetRateCents: type?.streetRateCents ?? line.quotedRateCents,
    }
  })

  const remaining = minutesLeft(session.lockExpiresAt)
  const lockedPromo = promoDiscountOn(session)

  // Session data wins over the reservation prefill: if the renter has already
  // corrected something on this step, their correction is what comes back.
  const detailsPrefill = { ...prefill, ...(session.data as Partial<typeof prefill>) }
  // B-112. Whether the stored city and state were TYPED rather than derived —
  // the only signal that the renter used the disclosure, since the session
  // carries a city and state from the first submit either way.
  const derivedLocality = localityForZip(detailsPrefill.postalCode ?? '')
  const manualLocality = Boolean(
    detailsPrefill.city &&
      detailsPrefill.state &&
      (!derivedLocality ||
        derivedLocality.city !== detailsPrefill.city ||
        derivedLocality.state !== detailsPrefill.state),
  )

  // §6.4's back control. Present on every step the renter can leave: not on the
  // first (there is nothing behind it), not on the confirmation (the move-in is
  // done), and withdrawn on the payment step once the charge has left `pending`
  // — at which point "nothing has been charged yet" would be a lie and `goBack`
  // would refuse anyway.
  // B-149. `availableCount` is the same number `relock` acts on, so the branch
  // the panel shows and the button it offers cannot disagree.
  // B-172, found while building it. `session.lockLapsed` is derived from the
  // clock alone, and a COMPLETED checkout's lock ages out like any other — so a
  // renter who had paid and came back to their link half an hour later was
  // shown "We couldn't keep that unit" and a "Find me another unit" button,
  // while the "You are moved in" confirmation (which lives inside the
  // `!lockLapsed` section) was hidden from them. The lock is only meaningful
  // while there is still something to hold.
  const lockLapsed =
    session.lockLapsed && session.step !== 'provisioned' && session.status !== 'completed'

  const sizeStillAvailable = (unitType?.availableCount ?? 0) > 0
  const alternatives = alternativeSizes(inventory?.unitTypes ?? [], session.unitTypeId)
  const lostPhone = phoneFor(inventory?.facility.phone ?? null)

  // B-172. Whether the branch can actually DO anything with the answers it says
  // it has kept. `relockAtSize` refuses from the payment step onward — an intent
  // already made for the old size comes back at the old amount for 24 hours,
  // because Stripe's idempotency key is the session — so the copy below must not
  // promise a move the server would refuse. Same condition, both places.
  const canMoveSize =
    session.step !== 'payment' && session.step !== 'provisioned' && alternatives.length > 0

  /// The trade, in the renter's terms rather than ours: what this size costs
  /// against the one they lost, and how much floor it gives them for it.
  const tradeAgainstLost = (type: { sqFt: number; webRateCents: number }): string => {
    const rateDiff = type.webRateCents - session.quotedRateCents
    const money =
      rateDiff === 0
        ? t('checkout.samePrice')
        : t('checkout.priceDiff', {
            amount: formatCents(Math.abs(rateDiff)),
            direction: t(rateDiff > 0 ? 'checkout.more' : 'checkout.less'),
          })
    if (!unitType) return money
    const areaDiff = type.sqFt - unitType.sqFt
    const area =
      areaDiff === 0
        ? t('checkout.sameArea')
        : t('checkout.areaDiff', {
            amount: Math.abs(areaDiff),
            direction: t(areaDiff > 0 ? 'checkout.bigger' : 'checkout.smaller'),
          })
    return t('checkout.trade', { area, money })
  }

  const stepIndex = STEPS.indexOf(session.step)
  const previousStep = stepIndex > 0 ? STEPS[stepIndex - 1] : null
  const canGoBack =
    previousStep !== null &&
    session.step !== 'provisioned' &&
    !lockLapsed &&
    !(session.step === 'payment' && payment?.available && payment.settling)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {t('checkout.title')}
      </h1>

      {/* Above everything conditional on purpose: it has to outlive the step it
          is reporting on. See the note in announcer.tsx. */}
      <CheckoutAnnouncer
        step={session.step}
        stepLabel={stepAnnouncement(session.step, dict)}
        lockExpiresAt={session.lockExpiresAt.toISOString()}
        lapsed={lockLapsed}
        sizeLabel={
          unitType
            ? t('checkout.unitLabel', {
                width: unitType.widthFt,
                length: unitType.lengthFt,
                name: unitType.name,
              })
            : ''
        }
      />

      <div className="mt-6">
        <Stepper current={session.step} token={token} dict={dict} />
      </div>

      {/* FR-4.1's unit-lost fallback. The renter keeps every answer they have
          given; only the unit changes.

          B-149: and when the size is genuinely gone, this stops being a dead
          end. It used to say "call us" with no number on it — the highest-intent
          moment in the whole funnel, ending in an instruction the renter cannot
          follow. The branch is decided from `availableCount`, the same number
          `relock` will act on, so the screen and the button agree; a relock that
          loses the race re-renders here with the sold-out half showing. */}
      {/* Every control in this panel removes the panel when it works, so the
          outcome cannot be announced from inside it — B-170's rule. It does not
          need a second region: `CheckoutAnnouncer` above already exists for
          exactly this transition, survives it, announces it and moves focus to
          the step heading. B-172 only had to teach it that the size can now
          change as well as the unit. */}
      {lockLapsed && (
        <section aria-labelledby="lost" className="border-input mt-6 rounded-lg border p-4">
          <h2 id="lost" className="text-xl font-medium">
            {t('checkout.lostHeading')}
          </h2>
          <p className="mt-2 text-pretty">
            {t('checkout.lostIntro')}{' '}
            <strong>{t('checkout.nothingCharged')}</strong>{' '}
            {sizeStillAvailable
              ? t('checkout.lostSameSize')
              : canMoveSize
                ? t('checkout.lostCanMove')
                : t('checkout.lostCannotMove')}
          </p>

          {sizeStillAvailable ? (
            <AdminForm action={relockAction} label={t('checkout.findAnother')} className="mt-3">
              <input type="hidden" name="sessionId" value={session.id} />
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
              >
                {t('checkout.findAnotherSameSize')}
              </button>
            </AdminForm>
          ) : (
            <div className="mt-4 grid gap-4">
              <p className="text-pretty">
                <CallLink
                  phone={lostPhone}
                  className="font-medium underline underline-offset-4"
                />{' '}
                {t('checkout.callAndWeWillFind')}
              </p>

              {/* The facility's own ordering, smallest first. No recommender:
                  B-149 rules one out, and the list the facility page already
                  renders is what a renter would have browsed anyway.

                  B-172: each one is a SUBMIT, not a link. B-149 shipped this as
                  a display — the copy said every answer was still here while
                  the only control on the panel re-claimed the size that had
                  just gone, so the one thing the renter could do with those
                  answers was abandon them and start again. `relockAtSize`
                  re-points the session's line, re-quotes the rate and
                  re-evaluates the promotion for the new size, and returns them
                  to the step they were on. The link to the facility page stays
                  once, below, for reading about a size rather than taking it. */}
              {alternatives.length > 0 && inventory && (
                <div>
                  <h3 className="font-medium">
                    {canMoveSize
                      ? t('checkout.moveToAnotherSize', { facility: inventory.facility.name })
                      : t('checkout.otherSizesAt', { facility: inventory.facility.name })}
                  </h3>
                  <ul className="mt-2 grid gap-2">
                    {alternatives.map((type) => (
                      <li key={type.unitTypeId} className="flex flex-wrap items-baseline gap-x-2">
                        {/* The glyphs are decoration and the words are the name.
                            Without the pair a screen reader says "10 prime times
                            10 prime Standard" — the whole recovery path, at the
                            highest-intent moment in the funnel, unreadable
                            (2.4.4, 2.4.6). The same pair is already used
                            correctly three files over. */}
                        <span className="font-medium">
                          <span aria-hidden="true">
                            {type.widthFt}&prime; &times; {type.lengthFt}&prime; {type.name}
                          </span>
                          <span className="sr-only">
                            {t('checkout.unitLabel', {
                              width: type.widthFt,
                              length: type.lengthFt,
                              name: type.name,
                            })}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatCents(type.webRateCents)}
                          {t('card.perMonth')}
                        </span>
                        <span className="text-muted-foreground text-sm text-pretty">
                          {tradeAgainstLost(type)}
                        </span>
                        {canMoveSize && (
                          <AdminForm
                            action={relockAtSizeAction}
                            label={t('checkout.moveMeToSize', {
                              width: type.widthFt,
                              length: type.lengthFt,
                              name: type.name,
                            })}
                            className="w-full"
                          >
                            <input type="hidden" name="sessionId" value={session.id} />
                            <input type="hidden" name="unitTypeId" value={type.unitTypeId} />
                            {/* Named on the BUTTON, not only on the form. No
                                screen reader composes a form's label into its
                                descendants' names, so a rotor listing this
                                panel's buttons would otherwise hear "Move me to
                                this size" once per size with nothing telling
                                them apart (2.4.6) — the rule
                                `task-complete-form.tsx` states in a comment on
                                the component created to fix it. */}
                            <button
                              type="submit"
                              aria-label={t('checkout.moveMeToSize', {
                                width: type.widthFt,
                                length: type.lengthFt,
                                name: type.name,
                              })}
                              className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                            >
                              {t('checkout.moveMeToThisSize')}
                            </button>
                          </AdminForm>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm">
                    <LocaleLink
                      href={facilityPath(inventory.facility)}
                      className="underline underline-offset-4"
                    >
                      {t('checkout.readAboutSizes', { facility: inventory.facility.name })}
                    </LocaleLink>
                  </p>
                </div>
              )}

              {/* US-43. The same capture the facility page offers on a sold-out
                  size, at the moment somebody has proved they want it. */}
              {unitType && (
                <div>
                  <h3 className="font-medium">
                    <span aria-hidden="true">
                      Or wait for a {unitType.widthFt}&prime; &times; {unitType.lengthFt}&prime;
                    </span>
                    <span className="sr-only">
                      {t('checkout.orWaitFor', {
                        width: unitType.widthFt,
                        length: unitType.lengthFt,
                      })}
                    </span>
                  </h3>
                  <WaitlistForm
                    facilityId={session.facilityId}
                    unitTypeId={unitType.unitTypeId}
                    sizeLabel={t('facility.footBy', {
                      width: unitType.widthFt,
                      length: unitType.lengthFt,
                    })}
                    action={joinWaitlistAction}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 2.2.1 Timing Adjustable. The threshold is watched by a client timer,
          not decided once at render time — on the lease step nothing submits
          between T-30 and the signature, so a server-rendered verdict never
          became true and the renter's first news of the deadline was it
          passing. See lock-warning.tsx. */}
      {!lockLapsed && (
        <LockWarning
          token={token!}
          lockExpiresAt={session.lockExpiresAt.toISOString()}
          warningMinutes={LOCK_WARNING_MINUTES}
          initialRemaining={remaining}
        />
      )}

      {!lockLapsed && (
        <section aria-labelledby="step" className="mt-8">
          {/* Each step's own form arrives with its item; what this owns is that
              the heading exists, is focusable, and names where the renter is. */}
          <h2 id="step" tabIndex={-1} className="text-xl font-medium">
            {session.step === 'details' && t('step.details')}
            {session.step === 'unit_assign' && t('step.unit_assign')}
            {session.step === 'insurance' && t('checkout.stepProtect')}
            {session.step === 'lease' && t('checkout.stepLease')}
            {session.step === 'payment' && t('step.payment')}
            {session.step === 'provisioned' && t('checkout.stepMovedIn')}
          </h2>

          {/* Session data wins over the reservation prefill: if the renter has
              already corrected something on this step, their correction is what
              comes back when they return to it. */}
          {session.step === 'details' && (
            <DetailsStep
              token={token!}
              prefill={detailsPrefill}
              manualLocality={manualLocality}
              dict={dict}
            />
          )}

          {session.step === 'unit_assign' && unitType && (
            <UnitStep
              token={token!}
              lines={basketLines}
              addableTypes={addableTypes}
              facilityName={inventory!.facility.name}
              // B-106. The renter's own earlier answer survives a step back
              // (§6.4), falling back to today when they have not chosen yet.
              startDate={
                session.requestedStartDate
                  ? isoDate(session.requestedStartDate)
                  : isoDate(startWindow.earliest)
              }
              earliest={isoDate(startWindow.earliest)}
              latest={isoDate(startWindow.latest)}
              dict={dict}
            />
          )}

          {session.step === 'insurance' && (
            <ProtectionStep
              token={token!}
              plans={plans}
              defaultTier={
                chosenProtection === 'waiver'
                  ? '__waiver__'
                  : (chosenProtection ?? defaultTier(plans))
              }
              required={facilityPolicy?.protectionRequired ?? true}
              dict={dict}
              waiver={
                priorWaiver && {
                  // Nullable on the model — a waiver can also be raised by
                  // staff from a document with the details still to come.
                  carrier: priorWaiver.carrier ?? '',
                  policyNumber: priorWaiver.policyNumber ?? '',
                  // `<input type="date">` takes yyyy-mm-dd and nothing else.
                  expiresAt: priorWaiver.expiresAt?.toISOString().slice(0, 10) ?? '',
                }
              }
            />
          )}

          {session.step === 'lease' && leases.length > 0 && (
            <LeaseStep
              token={token!}
              leases={leases}
              signedOn={signedOn}
              legalName={`${(session.data as Record<string, string>).firstName ?? ''} ${
                (session.data as Record<string, string>).lastName ?? ''
              }`.trim()}
              // B-112: moved here from step 1, and prefilled from the session
              // so B-111's back navigation does not lose them.
              altContactName={
                typeof session.data.altContactName === 'string'
                  ? session.data.altContactName
                  : undefined
              }
              altContactPhone={
                typeof session.data.altContactPhone === 'string'
                  ? session.data.altContactPhone
                  : undefined
              }
              activeDutyMilitary={session.data.activeDutyMilitary === true}
              dict={dict}
            />
          )}

          {session.step === 'payment' && payment && due && (
            <PaymentStep
              token={token!}
              due={due}
              payment={payment}
              autopayOn={session.data.autopay !== false}
              returnUrl={`${process.env.AUTH_URL ?? 'http://localhost:3000'}/checkout?token=${encodeURIComponent(token!)}`}
              // B-044: the day this renter will actually be billed on, not a
              // constant. Under anniversary billing (the default) that is the
              // day they are moving in.
              billingDay={billingDayFor(
                facilityPolicy?.billingPolicy ?? 'anniversary',
                businessDateFor(new Date(), facilityPolicy?.timezone ?? 'UTC'),
              )}
              counterTender={counterTender}
              dict={dict}
            />
          )}

          {session.step === 'provisioned' && (
            <div className="mt-4">
              <p className="text-pretty">
                {t('checkout.emailedTo')} <strong>{session.email}</strong>.
              </p>
              {/* B-239. The email is the only copy of the lease the renter has,
                  and "it never arrived" is the commonest first support call
                  after a move-in. One sentence, beside the claim it qualifies,
                  rather than a support page to find. */}
              <p className="text-muted-foreground mt-1 text-sm text-pretty">
                {t('checkout.didntArrive')}{' '}
                <CallLink phone={lostPhone} className="underline underline-offset-4" />{' '}
                {t('checkout.didntArriveAfter')}
              </p>

              {/* US-501 step 7. `confirmationCode` is null whenever there is
                  nothing to reveal yet (no encryption key configured, or
                  issuance hasn't landed) — the fallback says what is true
                  rather than showing a placeholder that looks like a code. */}
              {confirmationCode ? (
                <div className="border-input mt-4 rounded-lg border p-4">
                  <p className="text-muted-foreground text-sm">{t('checkout.yourGateCode')}</p>
                  <p className="mt-1 text-4xl font-semibold tracking-widest tabular-nums select-all">
                    {confirmationCode}
                  </p>
                  {reservation?.unit?.number && (
                    <p className="text-muted-foreground mt-2 text-sm">
                      {t('checkout.unitNumber', { number: reservation.unit.number })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="border-input mt-4 rounded-lg border p-4 text-pretty">
                  {t('checkout.codeComing')}{' '}
                  <CallLink phone={lostPhone} className="font-medium underline underline-offset-4" />{' '}
                  {t('checkout.codeComingAfter')}
                </p>
              )}

              {/* B-239 / US-601. The three facts this screen was required to
                  restate and never did: the next charge amount, its date, and
                  the autopay state. The words are the payment step's own — a
                  renter who read "we will email you two days before every
                  charge" there must not meet a different promise here — and the
                  opt-out branch is real: `autopayEnabled` is read back from the
                  lease that was actually written, not from the session's
                  intention. */}
              {nextCharge && (
                <p className="mt-4 text-pretty">
                  {t('checkout.nextPaymentBefore')}{' '}
                  <strong className="tabular-nums">{formatRate(nextCharge.totalCents)}</strong>{' '}
                  {t('checkout.nextPaymentOn')}{' '}
                  {formatCalendarDate(nextCharge.dueDate, { month: 'long', day: 'numeric' })}.{' '}
                  {nextCharge.autopayEnabled
                    ? t('checkout.autopayOn')
                    : t('checkout.autopayOff')}
                </p>
              )}

              {/* B-239. The renter has just been told "This is your account —
                  no password needed" on the details step, and then never shown
                  it: the words "portal", "account" and "password" appeared
                  nowhere on this screen, so reaching the place they pay from
                  depended entirely on an email being opened. A real link whose
                  name says where it goes (SC 2.4.4). Signed-out visits to
                  /portal land on /login, which sends a sign-in link to the
                  address above — no password to invent at the counter. */}
              <p className="mt-4">
                <LocaleLink
                  href="/portal"
                  className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
                >
                  {t('checkout.goToAccount')}
                </LocaleLink>
              </p>

              {/* B-239. The top post-move-in call, and the one thing that stops
                  a renter driving back. Not a link: whether this facility sells
                  locks is a merchandise question this screen does not read, and
                  "or buy one at the office" is true wherever the counter has
                  them. */}
              <p className="text-muted-foreground mt-3 text-sm text-pretty">
                {t('checkout.bringALock')}
              </p>

              {confirmationFacility && (
                <div className="mt-4 text-sm text-pretty">
                  <address className="not-italic">{formatAddress(confirmationFacility)}</address>
                  <p className="mt-1">{todaysGateHours(confirmationFacility, dict)}</p>
                  <p className="mt-1">
                    <a
                      href={directionsUrl(confirmationFacility)}
                      className="underline underline-offset-4"
                    >
                      {t('checkout.getDirections')}
                    </a>{' '}
                    ·{' '}
                    <LocaleLink
                      href={facilityPath(confirmationFacility)}
                      className="underline underline-offset-4"
                    >
                      {t('checkout.facilityHours')}
                    </LocaleLink>
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
            <AdminForm action={advanceAction} label={t('checkout.continue')} className="mt-4">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="from" value={session.step} />
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
              >
                {t('checkout.continue')}
              </button>
            </AdminForm>
          )}

          {/* §6.4. Below Continue, same height, next in the tab order. Inside
              the step section on purpose: it unmounts with the step, so its
              success message never competes with the announcer above — only a
              REFUSAL renders here, and a refusal is exactly what the renter
              needs to see in place. */}
          {canGoBack && previousStep && (
            <BackControl
              token={token!}
              to={previousStep}
              label={t('checkout.backTo', {
                step: labelForStep(previousStep, dict).toLowerCase(),
              })}
              note={
                session.step === 'payment'
                  ? t('checkout.backNoteNothingCharged')
                  : undefined
              }
            />
          )}
        </section>
      )}

      {/* B-172. Not while the lock has lapsed. `PriceSummary` and the code box
          rendered regardless, so a renter who had just been told we could not
          keep their unit was still being shown a sticky "Due today $187.42 …
          then $129/mo" for it — a quote for a unit that is no longer theirs,
          under a panel saying so. Suppressed rather than restated in the past
          tense: the figure is void either way, and the price of every size they
          CAN take is on the button beside it. It comes back the moment the
          session holds a unit again, with `changeNote` naming what moved it. */}
      {unitType && !lockLapsed && (
        <div className="mt-8">
          <PriceSummary
            // B-106 part 5. The whole basket, so the summary's arithmetic is
            // `amountDueToday`'s arithmetic. It used to be handed the session's
            // single `quotedRateCents` and one unit's street rate, which for a
            // two-unit basket would have advertised one unit's rent one screen
            // before charging for two — the release-blocking disagreement
            // US-301 names, and the reason the summary takes the lines rather
            // than a pre-summed total.
            units={summaryUnits}
            dict={dict}
            facilityName={inventory!.facility.name}
            // Per unit, as D-52 has it. The summary multiplies by the basket
            // size itself rather than being handed a product, so the "× N"
            // disclosure and the figure cannot come apart.
            protectionPremiumCents={
              typeof session.data.protectionPremiumCents === 'number'
                ? session.data.protectionPremiumCents
                : undefined
            }
            adminFeeCents={inventory!.pricing.adminFeeCents}
            taxRates={inventory!.pricing.taxRates}
            // The promotion the facility page advertised, locked onto the
            // session at "Rent now". Until this shipped the card said "50% off"
            // and every figure from here on said full price.
            promoDiscountCents={lockedPromo?.firstPeriodCents}
            promoTerms={lockedPromo?.terms}
            // §6.4: the prop has existed since B-020 and was passed by nobody,
            // which is why choosing a $12/mo protection tier moved both totals
            // with no stated cause one screen before the card form. `advance`
            // writes it and clears it, so it always describes the step just
            // taken and never the one before that.
            changeNote={
              typeof session.data.changeNote === 'string' ? session.data.changeNote : undefined
            }
          />
          {/* PRD 04 US-11 AC3 (B-122). Directly under the summary, because the
              summary is what the code changes — and not on the payment step,
              where the total has already been authorised (§6.4) and
              `provisionMoveIn` is about to redeem the schedule the session
              locked. The action refuses a completed checkout regardless; this
              is the same rule stated where the renter can see it. */}
          {session.step !== 'payment' && session.step !== 'provisioned' && (
            <PromoCodeStep
              token={token!}
              action={applyPromoCodeAction}
              appliedTerms={lockedPromo?.terms ?? null}
              dict={dict}
            />
          )}
        </div>
      )}
    </div>
  )
}
