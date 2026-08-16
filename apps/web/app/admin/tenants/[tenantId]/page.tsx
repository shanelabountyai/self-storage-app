import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { tenantProfile } from '@/lib/admin/tenants'
import { formatCents } from '@/lib/format'
import { AdminForm, Field, FieldSet } from '@/components/admin/form'
import {
  addNoteAction,
  flagAddressReturnedAction,
  logDocumentAction,
  setNotePinnedAction,
  updateActiveDutyAction,
  updateAddressAction,
  liftHoldAction,
  placeHoldAction,
  refundAction,
  setExtendedHoursAction,
  updateContactAction,
  waiveFeeAction,
} from './actions'
import { HOLD_TYPES, type HoldEffect } from '@storage/core/holds'
import { leaseStatusLabel } from '@storage/core/labels'
import { referralsForStaff, REFERRAL_STATE_LABELS } from '@/lib/referrals/portal'

/// The effects in an operator's words, on the banner. The catalog names them
/// for code; a staffer needs to know what stopped.
const EFFECT_LABELS: Record<HoldEffect, string> = {
  halt_dunning: 'collections chasing',
  halt_late_fees: 'late fees',
  halt_access_suspension: 'gate suspension',
  block_auction: 'auction',
  suppress_marketing: 'marketing',
  halt_autopay: 'automatic card payments',
}

/// The reason vocabulary from the audit catalog, narrowed to the ones that
/// actually explain a waived fee. Free text stays available in the note beside
/// it — the code is what keeps the audit log filterable.
const WAIVER_REASONS = [
  { value: 'customer_goodwill', label: 'Customer goodwill' },
  { value: 'billing_error', label: 'Billing error' },
  { value: 'system_error', label: 'System error' },
  { value: 'management_approval', label: 'Management approval' },
  { value: 'duplicate', label: 'Duplicate charge' },
  { value: 'other', label: 'Other (explain in the note)' },
] as const

export const metadata = { title: 'Tenant profile' }

// PRD 02 §4.4 US-13/US-16. "Any staffer can pick up any conversation" — one
// screen: contact, address history, every lease and its balance, notes,
// logged documents, and what has been sent.

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default async function TenantProfilePage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params
  const actor = await getAdminActor()
  const profile = await tenantProfile(actor, tenantId)
  // PRD 10 §5.7 (B-101). Both sides — this tenant may be the referrer on one
  // and the referee on another.
  const referrals = await referralsForStaff(tenantId)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin/tenants" className="text-sm underline underline-offset-2">
          ← Back to search
        </Link>
        <h1 className="mt-1 text-lg font-semibold">
          {profile.firstName} {profile.lastName}
        </h1>
        {/* "Profile shows delinquency status prominently" — but nothing sets
            Lease.status to delinquent yet (B-057), so the real signal today is
            the ledger, same as the portal dashboard. */}
        {profile.totalBalanceCents > 0 && (
          <p role="alert" className="mt-2 inline-block rounded-md border border-red-300 bg-red-50 px-3 py-1 text-sm text-red-900">
            Balance due: {formatCents(profile.totalBalanceCents)}
          </p>
        )}
      </div>

      {/* US-45's plain-English access line. Beside the hold banner because
          they answer the same question — why can this tenant not get in — and a
          staffer on the phone should not have to hunt for either. */}
      {profile.accessState.length > 0 && (
        <section aria-labelledby="access-heading" className="flex flex-col gap-2">
          <h2 id="access-heading" className="sr-only">
            Gate access
          </h2>
          {profile.accessState.map((row) => (
            <p
              key={row.facilityName}
              className={
                row.suspended
                  ? 'rounded-lg border-2 border-red-600 bg-red-50 p-3 text-sm font-medium text-red-950'
                  : 'text-muted-foreground text-sm'
              }
            >
              {/* 1.4.1: the words carry it, not the border. */}
              {row.suspended ? 'Gate access suspended' : 'Gate access active'} — {row.facilityName}
              {row.summary ? `. ${row.summary}` : ''}
              {row.suspended ? '. It turns back on automatically when the balance reaches zero.' : ''}
            </p>
          ))}
        </section>
      )}

      {/* US-42's persistent banner. First thing under the heading, before any
          control that could act on the account — a manager must never be able
          to approve a sale, or send a notice, without the hold in view. Never
          colour alone (1.4.1): the label and the note carry the meaning. */}
      {profile.emailUndeliverableAt && (
        // FR-15. Not colour alone (WCAG 1.4.1): the heading says "cannot be
        // reached", which is the whole message even in greyscale.
        <div role="note" className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-red-950">
          <p className="font-semibold">Email cannot be reached</p>
          <p className="mt-1 text-sm text-pretty">
            Mail to {profile.email} bounced on {formatWhen(profile.emailUndeliverableAt)} and is now
            suppressed, so no further notices will go out by email. There is an open task for this.
            Reach them by phone; once the address is working again, lift the suppression under
            Settings → Suppressions and this clears.
          </p>
        </div>
      )}

      {profile.holds.length > 0 && (
        <section aria-labelledby="holds-heading" className="flex flex-col gap-3">
          <h2 id="holds-heading" className="sr-only">
            Holds on this account
          </h2>
          {profile.holds.map((hold) => (
            <div
              key={hold.id}
              role="note"
              className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950"
            >
              <p className="font-semibold">
                On hold — {hold.label} · Unit {hold.unitNumber}
              </p>
              <p className="mt-1 text-sm text-pretty">{hold.bannerNote}</p>
              <p className="mt-2 text-sm text-pretty">
                <span className="font-medium">Reason given:</span> {hold.reason}
              </p>
              {hold.estateContactName && (
                <p className="mt-1 text-sm text-pretty">
                  <span className="font-medium">Estate contact:</span> {hold.estateContactName}
                  {hold.estateContactPhone ? ` · ${hold.estateContactPhone}` : ''}
                  {hold.estateContactEmail ? ` · ${hold.estateContactEmail}` : ''}
                </p>
              )}
              <p className="mt-2 text-xs">
                Placed by {hold.placedByName} on {formatWhen(hold.effectiveFrom)}
                {hold.effectiveTo ? ` · ends ${formatWhen(hold.effectiveTo)}` : ' · no end date'}
              </p>
              <p className="mt-1 text-xs">
                Stops: {hold.effects.map((effect) => EFFECT_LABELS[effect] ?? effect).join(', ')}
              </p>

              <AdminForm
                action={liftHoldAction}
                label={`Lift the ${hold.label} hold`}
                className="mt-3 flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="tenantId" value={profile.tenantId} />
                <input type="hidden" name="holdId" value={hold.id} />
                <Field name="liftReason" label="Reason for lifting" />
                <button
                  type="submit"
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border bg-white px-4 text-sm font-medium"
                >
                  Lift hold
                  <span className="sr-only"> — {hold.label} on unit {hold.unitNumber}</span>
                </button>
                {hold.liftRequiresManager && (
                  <p className="w-full text-xs">
                    Lifting this hold needs a manager or above.
                  </p>
                )}
              </AdminForm>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="contact-heading" className="flex flex-col gap-3">
        <h2 id="contact-heading" className="font-medium">
          Contact
        </h2>
        <p className="text-sm">{profile.email}</p>
        <AdminForm action={updateContactAction} label="Contact details" className="grid max-w-lg grid-cols-2 gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field name="phone" label="Phone" type="tel" defaultValue={profile.phone ?? ''} className={FIELD_CLASS} />
          <Field
            name="altContactName"
            label="Alternate contact name"
            defaultValue={profile.altContactName ?? ''}
            className={FIELD_CLASS}
          />
          <Field
            name="altContactPhone"
            label="Alternate contact phone"
            type="tel"
            defaultValue={profile.altContactPhone ?? ''}
            className={FIELD_CLASS}
          />
          <Field
            name="altContactEmail"
            label="Alternate contact email"
            type="email"
            defaultValue={profile.altContactEmail ?? ''}
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="border-input hover:bg-accent col-span-2 inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            Save contact details
          </button>
        </AdminForm>
      </section>

      {referrals.length > 0 && (
        // PRD 10 §5.7 (B-101). "A referral record is visible on both tenants'
        // profiles, with the reward state and, when refused, the rule that
        // refused it." The AC behind it is the one that matters: "a tenant
        // asking 'why didn't I get my $50' must be answerable at the counter
        // in one screen."
        <section aria-labelledby="referrals-heading" className="flex flex-col gap-3">
          <h2 id="referrals-heading" className="font-medium">
            Referrals
          </h2>
          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Referrals this tenant made or arrived on, with the reward state and the rule that
                refused any that did not pay
              </caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">
                    Who
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    State
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Rewards
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((referral) => (
                  <tr key={referral.id} className="border-input border-b align-top">
                    <th scope="row" className="py-2 pr-4 text-left font-medium">
                      {referral.role === 'referrer'
                        ? `Referred ${referral.refereeName ?? 'nobody yet'}`
                        : `Referred by ${referral.referrerName}`}
                    </th>
                    <td className="py-2 pr-4">
                      {/* In words, never a colour alone — the same 1.4.1 rule
                          the portal table follows. */}
                      {REFERRAL_STATE_LABELS[referral.state]}
                      {referral.refusedReason && (
                        <>
                          <span className="text-muted-foreground mt-1 block text-xs text-pretty">
                            {referral.refusedReason}
                          </span>
                          {/* The rule's own key beside the sentence: the
                              staffer reads the sentence to the tenant and can
                              match the key to the rule in the PRD. */}
                          <span className="text-muted-foreground block font-mono text-xs">
                            {referral.refusedRule}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {referral.state === 'earned' ? (
                        <>
                          {formatCents(referral.referrerRewardCents)} referrer ·{' '}
                          {formatCents(referral.refereeRewardCents)} new tenant
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* B-121 / D-49. Its own section, not a fifth box in the contact grid:
          this is a legal-status declaration with automatic consequences on
          every lease the tenant holds, and filing it beside "alternate contact
          email" would read as one more optional detail. */}
      <section aria-labelledby="scra-heading" className="flex flex-col gap-3">
        <h2 id="scra-heading" className="font-medium">
          Military service
        </h2>
        <AdminForm action={updateActiveDutyAction} label="Military service" className="flex max-w-lg flex-col gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <FieldSet
            name="activeDutyMilitary"
            legend="Active-duty military (SCRA)"
            hint={
              profile.activeDutyMilitary === null
                ? 'Nobody has recorded an answer for this tenant. Recording yes stops collections, late fees, gate suspension, auction and marketing on every lease they hold — including at other facilities.'
                : 'Recording yes stops collections, late fees, gate suspension, auction and marketing on every lease they hold — including at other facilities.'
            }
          >
            <div className="mt-3 flex flex-col gap-2">
              <label className="border-input flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input
                  type="radio"
                  name="activeDutyMilitary"
                  value="yes"
                  defaultChecked={profile.activeDutyMilitary === true}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Yes — on active duty</span>
                  <span className="text-muted-foreground block text-sm">
                    Places an SCRA hold on every current lease straight away.
                  </span>
                </span>
              </label>
              <label className="border-input flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input
                  type="radio"
                  name="activeDutyMilitary"
                  value="no"
                  defaultChecked={profile.activeDutyMilitary === false}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">No</span>
                  <span className="text-muted-foreground block text-sm">
                    Corrects the record only. A hold already in force stays until a manager lifts it
                    on the lease below.
                  </span>
                </span>
              </label>
            </div>
          </FieldSet>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            Save military service
          </button>
        </AdminForm>
      </section>

      <section aria-labelledby="address-heading" className="flex flex-col gap-3">
        <h2 id="address-heading" className="font-medium">
          Address of record
        </h2>
        {profile.address?.returnedMailAt && (
          <p role="alert" className="border-input rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            Mail sent to this address was returned on {formatDate(profile.address.returnedMailAt)}. Confirm a
            current address before relying on it.
          </p>
        )}
        <AdminForm action={updateAddressAction} label="Address of record" className="grid max-w-lg grid-cols-2 gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field
            name="addressLine1"
            label="Street address"
            defaultValue={profile.address?.addressLine1 ?? ''}
            required
            className={`${FIELD_CLASS} col-span-2`}
          />
          <Field
            name="addressLine2"
            label="Apartment or unit"
            defaultValue={profile.address?.addressLine2 ?? ''}
            className={`${FIELD_CLASS} col-span-2`}
          />
          <Field name="city" label="City" defaultValue={profile.address?.city ?? ''} required className={FIELD_CLASS} />
          <Field
            name="state"
            label="State"
            defaultValue={profile.address?.state ?? ''}
            maxLength={2}
            required
            className={FIELD_CLASS}
          />
          <Field
            name="postalCode"
            label="ZIP code"
            defaultValue={profile.address?.postalCode ?? ''}
            required
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="border-input hover:bg-accent col-span-2 inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            Save address
          </button>
        </AdminForm>

        {profile.address && !profile.address.returnedMailAt && (
          <form action={flagAddressReturnedAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="addressId" value={profile.address.id} />
            <button type="submit" className="text-sm underline underline-offset-2">
              Flag as returned mail
            </button>
          </form>
        )}

        {profile.addressHistory.length > 1 && (
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">Address history</summary>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {profile.addressHistory.map((row) => (
                <li key={row.id} className="text-muted-foreground">
                  {row.addressLine1}
                  {row.addressLine2 ? `, ${row.addressLine2}` : ''}, {row.city} {row.state} {row.postalCode} —{' '}
                  {formatDate(row.createdAt)} ({row.source})
                  {row.returnedMailAt && ' · returned mail'}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="leases-heading" className="flex flex-col gap-3">
        <h2 id="leases-heading" className="font-medium">
          Leases
        </h2>
        {profile.leases.length === 0 ? (
          <p className="text-muted-foreground text-sm">No leases on file.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Leases held by this tenant</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-medium">Facility / Unit</th>
                <th scope="col" className="py-2 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">Rate</th>
                <th scope="col" className="py-2 text-right font-medium">Balance</th>
                <th scope="col" className="py-2 font-medium">Started</th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {profile.leases.map((lease) => (
                <tr key={lease.leaseId} className="border-b">
                  <td className="py-2">
                    {lease.facilityName} — {lease.unitNumber}
                  </td>
                  <td className="py-2 capitalize">{leaseStatusLabel(lease.status)}</td>
                  <td className="py-2">{formatCents(lease.monthlyRateCents)}/mo</td>
                  <td className={`py-2 text-right tabular-nums ${lease.balanceCents > 0 ? 'font-medium text-red-800' : ''}`}>
                    {formatCents(lease.balanceCents)}
                  </td>
                  <td className="py-2">{formatDate(lease.startDate)}</td>
                  <td className="py-2">
                    {lease.status !== 'ended' && (
                      <>
                        <Link
                          href={`/admin/tenants/${tenantId}/move-out?lease=${lease.leaseId}`}
                          className="underline underline-offset-2"
                        >
                          Move out
                          <span className="sr-only"> from unit {lease.unitNumber}</span>
                        </Link>
                        <Link
                          href={`/admin/tenants/${tenantId}/transfer?lease=${lease.leaseId}`}
                          className="ml-3 underline underline-offset-2"
                        >
                          Transfer
                          <span className="sr-only"> out of unit {lease.unitNumber}</span>
                        </Link>
                      </>
                    )}
                    <Link
                      href={`/admin/tenants/${profile.tenantId}/ledger/${lease.leaseId}`}
                      className="ml-3 underline underline-offset-2"
                    >
                      Ledger
                      <span className="sr-only"> for unit {lease.unitNumber}</span>
                    </Link>
                    <Link
                      href={`/admin/tenants/${profile.tenantId}/notices/${lease.leaseId}`}
                      className="ml-3 underline underline-offset-2"
                    >
                      Notices
                      <span className="sr-only"> for unit {lease.unitNumber}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {profile.waivableFees.length > 0 && (
        <section aria-labelledby="fees-heading" className="flex flex-col gap-3">
          <h2 id="fees-heading" className="font-medium">
            Outstanding fees
          </h2>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            Waiving posts a credit and voids the fee — the charge and the credit both stay on the
            ledger. It is audited with your name and the reason you pick.
          </p>
          <ul className="flex flex-col gap-3">
            {profile.waivableFees.map((fee) => (
              <li key={fee.invoiceId} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{formatCents(fee.outstandingCents)}</span>
                  <span className="text-muted-foreground text-xs">
                    Invoice {fee.number} · Unit {fee.unitNumber} · {formatWhen(fee.issuedOn)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-sm text-pretty">{fee.description}</p>

                <AdminForm
                  action={waiveFeeAction}
                  label={`Waive fee ${fee.number}`}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="tenantId" value={profile.tenantId} />
                  <input type="hidden" name="invoiceId" value={fee.invoiceId} />
                  <Field name="reasonCode" label="Reason" as="select" defaultValue="">
                    <option value="">Choose a reason…</option>
                    {WAIVER_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </Field>
                  <Field name="note" label="Note (optional)" />
                  <button
                    type="submit"
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                  >
                    Waive
                    <span className="sr-only">
                      {' '}
                      fee {fee.number} of {formatCents(fee.outstandingCents)}
                    </span>
                  </button>
                </AdminForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.refundable.length > 0 && (
        <section aria-labelledby="refunds-heading" className="flex flex-col gap-3">
          <h2 id="refunds-heading" className="font-medium">
            Refund a payment
          </h2>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            A card refund goes back to the card the tenant paid with. Cash and cheque refunds are
            recorded as a payable — the money is not paid until someone hands it over. Refunding
            unwinds what the payment settled, so the invoices reopen.
          </p>
          <ul className="flex flex-col gap-3">
            {profile.refundable.map((payment) => (
              <li key={payment.paymentId} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{formatCents(payment.refundableCents)} refundable</span>
                  <span className="text-muted-foreground text-xs">
                    {formatCents(payment.amountCents)} by {payment.method} on{' '}
                    {formatWhen(payment.receivedAt)}
                    {payment.receiptNumber ? ` · receipt #${payment.receiptNumber}` : ''}
                    {payment.refundedCents > 0
                      ? ` · ${formatCents(payment.refundedCents)} already refunded`
                      : ''}
                  </span>
                </div>

                <AdminForm
                  action={refundAction}
                  label={`Refund payment ${payment.paymentId}`}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="tenantId" value={profile.tenantId} />
                  <input type="hidden" name="paymentId" value={payment.paymentId} />
                  <Field
                    name="amountDollars"
                    label="Amount ($)"
                    type="text"
                    inputMode="decimal"
                    defaultValue={(payment.refundableCents / 100).toFixed(2)}
                  />
                  <Field name="method" label="Back as" as="select" defaultValue={payment.method === 'card' ? 'card' : 'cash'}>
                    <option value="card">Card (original method)</option>
                    <option value="cash">Cash</option>
                    <option value="check">Cheque</option>
                  </Field>
                  <Field name="checkNumber" label="Cheque number" hint="Cheques only." />
                  <Field name="reasonCode" label="Reason" as="select" defaultValue="">
                    <option value="">Choose a reason…</option>
                    {WAIVER_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </Field>
                  <Field name="note" label="Note (optional)" />
                  <button
                    type="submit"
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                  >
                    Refund
                    <span className="sr-only"> up to {formatCents(payment.refundableCents)}</span>
                  </button>
                </AdminForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="place-hold-heading" className="flex flex-col gap-3">
        <h2 id="place-hold-heading" className="font-medium">
          Place a hold
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          A hold stops automated collections on one lease from tonight. What each type stops is
          fixed — it is shown on the banner once placed. Placing and lifting are both audited.
        </p>
        <AdminForm action={placeHoldAction} label="Place a hold" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenantId" value={profile.tenantId} />
          <Field name="leaseId" label="Unit" as="select" defaultValue={profile.leases[0]?.leaseId ?? ''}>
            {profile.leases.map((lease) => (
              <option key={lease.leaseId} value={lease.leaseId}>
                {lease.unitNumber} — {lease.facilityName}
              </option>
            ))}
          </Field>
          <Field name="type" label="Type" as="select" defaultValue="">
            <option value="">Choose a type…</option>
            {HOLD_TYPES.map((type) => (
              <option key={type.type} value={type.type}>
                {type.label}
              </option>
            ))}
          </Field>
          <Field name="reason" label="Reason" hint="What you were told, and by whom." />
          <Field name="effectiveTo" label="Ends (optional)" type="date" hint="Leave empty for open-ended." />
          <Field name="estateContactName" label="Estate contact" hint="Required for a deceased tenant." />
          <Field name="estateContactPhone" label="Estate contact phone" type="tel" />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            Place hold
          </button>
        </AdminForm>
      </section>

      <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
        <h2 id="notes-heading" className="font-medium">
          Notes
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.notes.map((note) => (
            <li key={note.id} className="border-input rounded-lg border p-3 text-sm">
              <p className="text-pretty">{note.body}</p>
              {/* A <div>, not a <p>: a <form> is block-level and cannot
                  legally nest inside a paragraph — the browser was silently
                  closing the <p> early and re-parenting it, which is exactly
                  the kind of DOM mismatch that fails hydration. */}
              <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                <span>
                  {note.authorName} · {formatWhen(note.createdAt)}
                  {note.pinned && <span className="font-medium"> · Pinned</span>}
                </span>
                <form action={setNotePinnedAction} className="inline">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="noteId" value={note.id} />
                  <input type="hidden" name="pinned" value={note.pinned ? 'no' : 'yes'} />
                  <button type="submit" className="underline underline-offset-2">
                    {note.pinned ? 'Unpin' : 'Pin'}
                  </button>
                </form>
              </div>
            </li>
          ))}
          {profile.notes.length === 0 && <li className="text-muted-foreground text-sm">No notes yet.</li>}
        </ul>
        <AdminForm action={addNoteAction} label="Add a note" className="flex max-w-lg flex-col gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label htmlFor="note-body" className="text-sm">
            New note
          </label>
          <textarea
            id="note-body"
            name="body"
            rows={3}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
          <p className="text-muted-foreground text-xs">
            Corrections are new notes — an existing note can&apos;t be edited once saved.
          </p>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            Add note
          </button>
        </AdminForm>
      </section>

      <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
        <h2 id="documents-heading" className="font-medium">
          Documents
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.documents.map((document) => (
            <li key={document.id} className="border-input flex justify-between gap-2 rounded-lg border p-3 text-sm">
              <span>
                {document.downloadable ? (
                  <a
                    href={`/admin/documents/${document.id}/file`}
                    className="font-medium underline underline-offset-2"
                  >
                    {document.title}
                  </a>
                ) : (
                  <span className="font-medium">{document.title}</span>
                )}{' '}
                <span className="text-muted-foreground capitalize">({document.type.replace('_', ' ')})</span>
              </span>
              <span className="text-muted-foreground">{formatDate(document.createdAt)}</span>
            </li>
          ))}
          {profile.documents.length === 0 && <li className="text-muted-foreground text-sm">No documents yet.</li>}
        </ul>
        <AdminForm action={logDocumentAction} label="Log a document" className="flex max-w-lg flex-col gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field name="type" label="Type" as="select" defaultValue="other" className={FIELD_CLASS}>
            <option value="id_copy">ID copy</option>
            <option value="insurance_proof">Insurance proof</option>
            <option value="other">Other / correspondence</option>
          </Field>
          <Field name="title" label="Title" required className={FIELD_CLASS} />
          <label htmlFor="doc-note" className="text-sm">
            Note (optional)
          </label>
          <textarea
            id="doc-note"
            name="note"
            rows={2}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
          <p className="text-muted-foreground text-xs">
            This records that a document exists and what it says — there&apos;s nowhere to attach a file yet.
          </p>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            Log document
          </button>
        </AdminForm>
      </section>

      {profile.gateAccess.length > 0 && (
        <section aria-labelledby="gate-heading" className="flex flex-col gap-3">
          <h2 id="gate-heading" className="font-medium">
            Gate access
          </h2>
          {profile.gateAccess.map((grant) => (
            <form
              key={grant.grantId}
              action={setExtendedHoursAction}
              className="border-input flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <input type="hidden" name="grantId" value={grant.grantId} />
              <input type="hidden" name="facilityId" value={grant.facilityId} />
              <input type="hidden" name="tenantId" value={profile.tenantId} />
              <span>
                <span className="font-medium">{grant.facilityName}</span>
                <span className="text-muted-foreground"> · {grant.state}</span>
              </span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="extendedHours"
                  defaultChecked={grant.extendedHours}
                  className="size-4"
                />
                24-hour access (paid add-on)
              </label>
              <button
                type="submit"
                className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
              >
                Save
              </button>
            </form>
          ))}
          <p className="text-muted-foreground text-xs text-pretty">
            Off means this tenant&apos;s code works only during the facility&apos;s published gate
            hours. Saving queues the change to the gate controller — it is not instant if the
            controller is offline.
          </p>
        </section>
      )}

      <section aria-labelledby="gate-history-heading" className="flex flex-col gap-3">
        <h2 id="gate-history-heading" className="font-medium">
          Recent gate activity
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.accessHistory.map((event) => (
            <li
              key={event.id}
              className="border-input flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"
            >
              <span>
                {event.result === 'granted' ? 'Opened' : 'Denied'}
                <span className="text-muted-foreground"> · {event.facilityName}</span>
                {event.unitNumber && <span className="text-muted-foreground"> · {event.unitNumber}</span>}
              </span>
              <span className="text-muted-foreground">
                {event.flags.length > 0 && <span>{event.flags.join(', ')} · </span>}
                {formatWhen(event.occurredAt)}
              </span>
            </li>
          ))}
          {profile.accessHistory.length === 0 && (
            <li className="text-muted-foreground text-sm">No gate activity recorded.</li>
          )}
        </ul>
      </section>

      <section aria-labelledby="comms-heading" className="flex flex-col gap-3">
        <h2 id="comms-heading" className="font-medium">
          Communication history
        </h2>
<ul className="flex flex-col gap-2">
          {profile.messages.map((message) => (
            <li key={message.id} className="border-input rounded-lg border p-3 text-sm">
              {/* A native <details>: the exact text that went out is what makes
                  this a record rather than a summary, but twenty full bodies on
                  one page is unreadable. No JS, keyboard-operable as shipped. */}
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="font-medium">
                      {message.subjectSnapshot ?? message.templateKey}
                    </span>{' '}
                    <span className="text-muted-foreground uppercase">{message.channel}</span>
                  </span>
                  <span className="text-muted-foreground capitalize">
                    {message.status} · {formatWhen(message.createdAt)}
                  </span>
                </summary>
                <dl className="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt>To</dt>
                  <dd className="text-foreground">{message.toAddressMasked}</dd>
                  <dt>Template</dt>
                  <dd className="text-foreground">
                    {message.templateKey} · v{message.templateVersion}
                  </dd>
                  <dt>Triggered by</dt>
                  <dd className="text-foreground">{message.eventType ?? 'Sent directly by staff'}</dd>
                  {message.sentAt && (
                    <>
                      <dt>Handed to provider</dt>
                      <dd className="text-foreground">{formatWhen(message.sentAt)}</dd>
                    </>
                  )}
                </dl>
                {message.problem && (
                  <p role="note" className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">
                    {message.problem}
                  </p>
                )}
                <pre className="bg-muted mt-2 max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                  {message.bodySnapshot}
                </pre>
              </details>
            </li>
          ))}
          {profile.messages.length === 0 && (
            <li className="text-muted-foreground text-sm">Nothing sent to this tenant yet.</li>
          )}
        </ul>
      </section>
    </div>
  )
}
