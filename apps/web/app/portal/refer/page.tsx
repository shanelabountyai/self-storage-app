import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@storage/db'
import { AdminForm } from '@/components/admin/form'
import { requireTenantActor } from '@/lib/rbac/session'
import { ShareInvite } from '@/components/portal/share-invite'
import { siteOrigin } from '@/lib/marketing/origin'
import { formatRate } from '@/lib/format'
import { mintInviteAction } from './actions'
import { referralsForTenant, REFERRAL_STATE_LABELS } from '@/lib/referrals/portal'

export const metadata: Metadata = { title: 'Refer a friend' }

// PRD 10 §5.1 (B-100). The tenant's own view of the program.
//
// This page deliberately does NOT list past referrals with their states — that
// is §5.6 and belongs to B-101, which owns the privacy rules about what a
// referrer may see of their friend (first name and initial only; never their
// unit, balance or move-in date). What is here is the half §5.1 specifies: the
// outstanding invites, each with its code and share control, and the terms.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export default async function ReferPage() {
  const actor = await requireTenantActor()

  const lease = await prisma.lease.findFirst({
    where: { tenantId: actor.tenantId, status: { not: 'ended' } },
    orderBy: { startDate: 'desc' },
    select: {
      facility: {
        select: {
          id: true,
          name: true,
          slug: true,
          state: true,
          city: true,
          referralEnabled: true,
          referralRewardCents: true,
          refereeRewardCents: true,
          referralInviteExpiryDays: true,
          referralOpenInviteCap: true,
        },
      },
    },
  })

  const facility = lease?.facility ?? null
  const referrals = await referralsForTenant(actor.tenantId)
  const invites = facility
    ? await prisma.referralInvite.findMany({
        where: {
          referrerTenantId: actor.tenantId,
          facilityId: facility.id,
          redeemedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, code: true, expiresAt: true },
      })
    : []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Refer a friend</h1>
        {facility?.referralEnabled ? (
          <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
            When a friend rents at {facility.name} on your invite and their first payment clears,
            they get {formatRate(facility.refereeRewardCents)} off their first invoice and you get{' '}
            {formatRate(facility.referralRewardCents)} off your next one.
          </p>
        ) : (
          // §5.1 AC: "a tenant with no active lease sees why they cannot refer,
          // not a broken link." Same standard for a facility that has the
          // program switched off — say which it is.
          <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
            {facility
              ? `The referral program is not running at ${facility.name} at the moment.`
              : 'Referrals are for current tenants, and there is no active lease on your account right now.'}
          </p>
        )}
      </div>

      {facility?.referralEnabled && (
        <>
          <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
            <h2 id="invites-heading" className="font-medium">
              Your invites
            </h2>

            {invites.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                You have no unused invites. Make one and share it with a friend.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {invites.map((invite) => {
                  const link = `${siteOrigin()}/r/${invite.code}`
                  return (
                    <li key={invite.id} className="border-input rounded-lg border p-3">
                      {/* The code as SELECTABLE TEXT, and the link too. §5.1's
                          AC: "the code is selectable text and works without
                          JavaScript." Everything below this line is an
                          enhancement on top of something already usable — a
                          tenant can read this down a phone. */}
                      <p className="font-mono text-lg tracking-widest">{invite.code}</p>
                      <p className="text-muted-foreground mt-1 text-sm break-all">{link}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Good until {formatDate(invite.expiresAt)}. One friend each.
                      </p>
                      <div className="mt-2">
                        <ShareInvite
                          code={invite.code}
                          message={`Storage at ${facility.name} — use my invite and we both get a credit: ${link}`}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <AdminForm action={mintInviteAction} label="Make a new invite" className="flex flex-col gap-2">
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
              >
                Make a new invite
              </button>
            </AdminForm>
          </section>

          <section aria-labelledby="referrals-heading" className="flex flex-col gap-3">
            <h2 id="referrals-heading" className="font-medium">
              Your referrals
            </h2>

            {referrals.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing yet. When a friend uses one of your invites, it will show up here.
              </p>
            ) : (
              // A real <table> with <th scope>, which the row states as an
              // acceptance criterion rather than a preference (1.3.1): a
              // <div> grid gives a screen-reader user no way to associate a
              // cell with its column, and this table's whole content is
              // "which friend, what state, when".
              <div tabIndex={0} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    Every friend you have referred, what state their referral is in, and when the
                    credit lands
                  </caption>
                  <thead>
                    <tr className="border-input border-b text-left">
                      <th scope="col" className="py-2 pr-4">
                        Friend
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        State
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Credit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((referral) => (
                      <tr key={referral.id} className="border-input border-b align-top">
                        <th scope="row" className="py-2 pr-4 text-left font-medium">
                          {/* §5.6: first name and initial only, ever. Their
                              unit, balance and move-in date are things the
                              friend never agreed to share with whoever
                              referred them. */}
                          {referral.friend ?? <span className="text-muted-foreground">Not used yet</span>}
                        </th>
                        <td className="py-2 pr-4">
                          {/* In WORDS, never a coloured pill alone (1.4.1).
                              Colour is not the only way anything in this
                              codebase says something, and a state a
                              colour-blind tenant cannot read is a state they
                              have to phone about. */}
                          {REFERRAL_STATE_LABELS[referral.state]}
                          {referral.refusedReason && (
                            <span className="text-muted-foreground mt-1 block text-xs text-pretty">
                              {referral.refusedReason}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">
                          {referral.state === 'earned' ? (
                            <>
                              {formatRate(referral.rewardCents)}
                              <span className="text-muted-foreground block text-xs">
                                {referral.creditDate
                                  ? `on your ${formatDate(referral.creditDate)} invoice`
                                  : 'on your next invoice'}
                              </span>
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
            )}
          </section>

          <section aria-labelledby="terms-heading" className="flex flex-col gap-2">
            <h2 id="terms-heading" className="font-medium">
              The terms
            </h2>
            {/* §5.1's AC asks for "the plain-language terms" on this page, and
                §3's three consequences are the ones a tenant is most likely to
                be surprised by — so they are stated here rather than left to be
                discovered. The clawback and minimum-stay wording is on the
                attorney list (§9 Q1). */}
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              <li>Each invite works once, for one friend.</li>
              <li>
                Your friend has to be new to us — someone who has rented here before does not
                qualify.
              </li>
              <li>
                The credit is earned when they move in <strong>and</strong> their first payment
                clears, not when they reserve.
              </li>
              <li>
                Yours comes off your next invoice, which may be up to a month away. Theirs comes off
                their first.
              </li>
              <li>
                Neither credit is cash and neither is refundable. If you move out with an unused
                credit, it does not carry over.
              </li>
              <li>An unused invite expires after {facility.referralInviteExpiryDays} days.</li>
              <li>
                You can hold {facility.referralOpenInviteCap} unused invites at a time.
              </li>
            </ul>
          </section>
        </>
      )}

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  )
}
