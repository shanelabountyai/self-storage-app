import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { portalDocuments, portalPayments } from '@/lib/portal/documents'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'

export const metadata: Metadata = { title: 'Documents and receipts' }

// PRD 01 §4.7 US-705.

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    date,
  )
}

export default async function DocumentsPage() {
  const actor = await requireTenantActor()
  const [documents, payments] = await Promise.all([
    portalDocuments(actor.tenantId),
    portalPayments(actor.tenantId),
  ])

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Documents and receipts</h1>

      <section aria-labelledby="docs-heading" className="flex flex-col gap-3">
        <h2 id="docs-heading" className="font-medium">
          Your documents
        </h2>
        {documents.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            You don&apos;t have any documents on file yet. Your signed agreement appears here once
            you&apos;ve moved in.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <li
                key={document.id}
                className="border-input flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4"
              >
                <span className="text-sm">
                  <span className="font-medium">{document.title}</span>
                  {document.unitNumber && (
                    <span className="text-muted-foreground"> · Unit {document.unitNumber}</span>
                  )}
                  <span className="text-muted-foreground"> · {formatWhen(document.createdAt)}</span>
                </span>
                {/* An uploaded file is downloaded through the authenticated
                    route, never rendered: its bytes came from outside and the
                    viewer page renders markup. */}
                {document.downloadable && (
                  <a
                    href={`/portal/documents/${document.id}/file`}
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                  >
                    Download
                  </a>
                )}
                {document.viewable && (
                  <Link
                    href={`/portal/documents/${document.id}`}
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                  >
                    View
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
        <h2 id="payments-heading" className="font-medium">
          Payments
        </h2>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            No payments yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Payments on your account, most recent first</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="py-2 font-medium">
                  Unit
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.paymentId} className="border-b">
                  <td className="py-2">{formatWhen(payment.receivedAt)}</td>
                  <td className="py-2">{payment.unitNumber ?? '—'}</td>
                  <td className="py-2 text-right tabular-nums">{formatRate(payment.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-muted-foreground text-sm text-pretty">
          Need a receipt for one of these, or a statement for your accounts? Call{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>{' '}
          and we&apos;ll send it over.
        </p>
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  )
}
