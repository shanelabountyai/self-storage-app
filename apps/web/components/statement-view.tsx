import { formatCents } from '@/lib/format'
import type { LeaseStatement } from '@/lib/billing/statements'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'
import { en } from '@/lib/i18n/en'

// PRD 01 US-705 (B-102). The statement itself, rendered once and used by both
// the tenant portal and the admin.
//
// Shared deliberately rather than duplicated: staff answer "can you send me my
// March statement?" by looking at the same document the tenant is looking at,
// and two implementations of a financial summary is two chances for them to
// disagree in front of somebody's accountant.
//
// Semantic HTML, not a PDF — B-023's standing decision (see
// lib/documents/render.ts): no JavaScript PDF library available here emits
// TAGGED PDFs, and an untagged statement is the accessibility failure PRD 01
// §6.8.1 names explicitly. The browser's own print dialogue makes a paper copy.

const TYPE_KEYS: Record<string, MessageKey> = {
  charge: 'sv.type.charge',
  payment: 'sv.type.payment',
  credit: 'sv.type.credit',
  refund: 'sv.type.refund',
  adjustment: 'sv.type.adjustment',
  write_off: 'sv.type.write_off',
}

function formatDay(date: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(date)
}

// B-260 (D-122). `dict` is OPTIONAL and defaults to English, because this
// component is shared with the admin ledger and the admin surface is English
// throughout — the tenant's portal passes their own dictionary, staff pass
// nothing, and neither caller has to know about the other.
//
// The line DESCRIPTIONS are never translated. They are what the billing engine
// wrote onto the ledger, and this document's whole job is to reconcile against
// it — a translated description would make the tenant's statement disagree with
// the staff screen answering the phone about it.
export function StatementView({
  statement,
  dict = en,
  locale = 'en-US',
}: {
  statement: LeaseStatement
  dict?: Dictionary
  locale?: string
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  return (
    <>
      <dl className="border-input grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-4 text-sm">
        <dt>{t('sv.openingBalance', { label: statement.label })}</dt>
        <dd className="text-right font-medium">{formatCents(statement.openingBalanceCents)}</dd>
        <dt>{t('sv.charged')}</dt>
        <dd className="text-right">{formatCents(statement.totals.chargedCents)}</dd>
        <dt>{t('sv.paid')}</dt>
        <dd className="text-right">{formatCents(statement.totals.paidCents)}</dd>
        {statement.totals.creditedCents !== 0 && (
          <>
            <dt>{t('sv.credits')}</dt>
            <dd className="text-right">{formatCents(statement.totals.creditedCents)}</dd>
          </>
        )}
        {statement.totals.refundedCents !== 0 && (
          <>
            <dt>{t('sv.refunded')}</dt>
            <dd className="text-right">{formatCents(statement.totals.refundedCents)}</dd>
          </>
        )}
        {statement.totals.writtenOffCents !== 0 && (
          <>
            <dt>{t('sv.writtenOff')}</dt>
            <dd className="text-right">{formatCents(statement.totals.writtenOffCents)}</dd>
          </>
        )}
        <dt className="font-medium">{t('sv.closingBalance', { label: statement.label })}</dt>
        <dd className="text-right font-medium">{formatCents(statement.closingBalanceCents)}</dd>
      </dl>

      <section aria-labelledby="lines-heading" className="flex flex-col gap-3">
        <h2 id="lines-heading" className="font-medium">
          {t('sv.everythingHeading')}
        </h2>

        {statement.lines.length === 0 ? (
          // Said out loud rather than rendering an empty table. A month with no
          // activity is a legitimate answer for a bookkeeper, and a blank space
          // reads as a page that failed to load.
          <p className="text-muted-foreground text-sm text-pretty">
            {t('sv.nothingHappened', { label: statement.label })}
          </p>
        ) : (
          <ScrollRegion aria-label={t('sv.regionLabel')}>
            <table className="w-full min-w-lg text-left text-sm">
              <caption className="sr-only">
                {t('sv.caption', { unit: statement.unitNumber, label: statement.label })}
              </caption>
              <thead>
                <tr className="border-input border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('sv.colDate')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('sv.colWhat')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('sv.colType')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('sv.colAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((line, index) => (
                  <tr key={`${line.occurredAt.getTime()}-${index}`} className="border-input border-b">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatDay(line.occurredAt, statement.facilityTimezone, locale)}
                    </td>
                    <td className="py-2 pr-4">{line.description}</td>
                    <td className="text-muted-foreground py-2 pr-4">
                      {TYPE_KEYS[line.type] ? t(TYPE_KEYS[line.type]) : line.type}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {/* Signed as the ledger stores it, so the column adds up
                          to the movement between the two balances above. A
                          column of unsigned numbers would look tidier and would
                          not reconcile, which is the one thing a statement has
                          to do. */}
                      {formatCents(line.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

    </>
  )
}
