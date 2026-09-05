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
import { ScrollRegion } from '@/components/ui/scroll-region'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'refer.title') }
}

// PRD 10 §5.1 (B-100). The tenant's own view of the program.
//
// This page deliberately does NOT list past referrals with their states — that
// is §5.6 and belongs to B-101, which owns the privacy rules about what a
// referrer may see of their friend (first name and initial only; never their
// unit, balance or move-in date). What is here is the half §5.1 specifies: the
// outstanding invites, each with its code and share control, and the terms.

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
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
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">{t('refer.title')}</h1>
        {facility?.referralEnabled ? (
          <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
            {t('refer.offer', {
              facility: facility.name,
              friendReward: formatRate(facility.refereeRewardCents),
              yourReward: formatRate(facility.referralRewardCents),
            })}
          </p>
        ) : (
          // §5.1 AC: "a tenant with no active lease sees why they cannot refer,
          // not a broken link." Same standard for a facility that has the
          // program switched off — say which it is.
          <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
            {facility
              ? t('refer.notRunning', { facility: facility.name })
              : t('refer.noLease')}
          </p>
        )}
      </div>

      {facility?.referralEnabled && (
        <>
          <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
            <h2 id="invites-heading" className="font-medium">
              {t('refer.yourInvites')}
            </h2>

            {invites.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('refer.noInvites')}
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
                        {t('refer.goodUntil', { date: formatDate(invite.expiresAt, locale) })}
                      </p>
                      <div className="mt-2">
                        <ShareInvite
                          code={invite.code}
                          message={t('refer.shareMessage', { facility: facility.name, link })}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <AdminForm action={mintInviteAction} label={t('refer.makeInvite')} className="flex flex-col gap-2">
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
              >
                {t('refer.makeInvite')}
              </button>
            </AdminForm>
          </section>

          <section aria-labelledby="referrals-heading" className="flex flex-col gap-3">
            <h2 id="referrals-heading" className="font-medium">
              {t('refer.yourReferrals')}
            </h2>

            {referrals.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('refer.noReferrals')}
              </p>
            ) : (
              // A real <table> with <th scope>, which the row states as an
              // acceptance criterion rather than a preference (1.3.1): a
              // <div> grid gives a screen-reader user no way to associate a
              // cell with its column, and this table's whole content is
              // "which friend, what state, when".
              <ScrollRegion aria-label={t('refer.regionLabel')}>
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    {t('refer.caption')}
                  </caption>
                  <thead>
                    <tr className="border-input border-b text-left">
                      <th scope="col" className="py-2 pr-4">
                        {t('refer.colFriend')}
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        {t('refer.colState')}
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        {t('refer.colCredit')}
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
                          {referral.friend ?? (
                            <span className="text-muted-foreground">{t('refer.notUsedYet')}</span>
                          )}
                        </th>
                        <td className="py-2 pr-4">
                          {/* In WORDS, never a coloured pill alone (1.4.1).
                              Colour is not the only way anything in this
                              codebase says something, and a state a
                              colour-blind tenant cannot read is a state they
                              have to phone about. */}
                          {t(REFERRAL_STATE_LABELS[referral.state])}
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
                                  ? t('refer.onInvoiceDated', {
                                      date: formatDate(referral.creditDate, locale),
                                    })
                                  : t('refer.onNextInvoice')}
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
              </ScrollRegion>
            )}
          </section>

          <section aria-labelledby="terms-heading" className="flex flex-col gap-2">
            <h2 id="terms-heading" className="font-medium">
              {t('refer.terms')}
            </h2>
            {/* §5.1's AC asks for "the plain-language terms" on this page, and
                §3's three consequences are the ones a tenant is most likely to
                be surprised by — so they are stated here rather than left to be
                discovered. The clawback and minimum-stay wording is on the
                attorney list (§9 Q1). */}
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              <li>{t('refer.term1')}</li>
              <li>{t('refer.term2')}</li>
              <li>
                {t('refer.term3Before')} <strong>{t('refer.term3And')}</strong>{' '}
                {t('refer.term3After')}
              </li>
              <li>{t('refer.term4')}</li>
              <li>{t('refer.term5')}</li>
              <li>{t('refer.term6', { days: facility.referralInviteExpiryDays })}</li>
              <li>{t('refer.term7', { cap: facility.referralOpenInviteCap })}</li>
            </ul>
          </section>
        </>
      )}

      <Link href="/portal" className="text-sm underline underline-offset-4">
        {t('paypg.backToAccount')}
      </Link>
    </div>
  )
}
