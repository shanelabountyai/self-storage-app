import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenantActor } from '@/lib/rbac/session'
import { leaseStatement, tenantMayViewLease } from '@/lib/billing/statements'
import { StatementView } from '@/components/statement-view'
import { parseStatementPeriod } from '@/lib/billing/statement-period'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'sv.title') }
}

// PRD 01 US-705 (B-102). One lease, one month, for the tenant it belongs to.

export default async function StatementPage({
  params,
}: {
  params: Promise<{ leaseId: string; period: string }>
}) {
  const { leaseId, period } = await params
  const actor = await requireTenantActor()

  const parsed = parseStatementPeriod(period)
  if (!parsed) notFound()

  // Checked before anything is read. A statement is a full month of somebody's
  // financial history and the lease id is in the URL — an unscoped read here
  // would hand one tenant another's.
  if (!(await tenantMayViewLease(actor.tenantId, leaseId))) notFound()

  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const statement = await leaseStatement({
    leaseId,
    year: parsed.year,
    month: parsed.month,
    // B-260: the month name in the reader's language, on the document as well
    // as in the list that links to it.
    locale,
  })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/portal/statements" className="underline underline-offset-4">
          {t('sv.allStatements')}
        </Link>
      </p>

      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">
          {t('sv.pageTitle', { label: statement.label })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t('sv.unitFacility', {
            unit: statement.unitNumber,
            facility: statement.facilityName,
          })}
        </p>
        <p className="text-muted-foreground text-sm">
          {statement.tenantName} · {SITE.name}
        </p>
      </header>

      <StatementView statement={statement} dict={dict} locale={locale} />

      <p className="text-muted-foreground text-xs text-pretty">
        {t('sv.printNote', { facility: statement.facilityName })}
      </p>
    </div>
  )
}
