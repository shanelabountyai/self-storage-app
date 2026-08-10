import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminActor } from '@/lib/admin/context'
import { noticesForLease, previewNotice, DEFAULT_DEADLINE_DAYS } from '@/lib/notices/service'
import {
  DELIVERY_METHOD_LABELS,
  DELIVERY_PROOF_FIELDS,
  NOTICE_DELIVERY_METHODS,
  NOTICE_DISCLAIMER,
  NOTICE_TYPES,
} from '@storage/core/notices'
import { formatCents } from '@/lib/format'
import { generateNoticeAction, recordDeliveryAction } from './actions'

export const metadata = { title: 'Notices' }

// PRD 02 §4.6 US-27 (B-061). Generating a lien notice for one lease, and
// recording how it was served.
//
// The preview is rendered from the same `noticeContext` the generation uses, so
// what a staffer reads here is exactly what gets stored and hashed. When a
// notice cannot be generated, this page says why — a lease whose ledger and
// invoices disagree is a refusal with a reason, not a missing button.

const TYPE_LABELS: Record<string, string> = {
  pre_lien: 'Pre-lien notice',
  lien: 'Lien notice',
}

const PROOF_LABELS: Record<string, string> = {
  tracking_number: 'Tracking number',
  note: 'Note',
  photo_reference: 'Photo reference',
  email_address: 'Email address it went to',
}

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

export default async function LeaseNoticesPage({
  params,
}: {
  params: Promise<{ tenantId: string; leaseId: string }>
}) {
  const { tenantId, leaseId } = await params
  const actor = await getAdminActor()

  const notices = await noticesForLease(actor, leaseId).catch(() => null)
  if (notices === null) notFound()

  // One preview per type, each carrying its own refusal reason if it has one.
  const previews = await Promise.all(NOTICE_TYPES.map((type) => previewNotice(actor, leaseId, type)))

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Notices</h1>
        <Link href={`/admin/tenants/${tenantId}`} className="text-sm underline underline-offset-2">
          Back to tenant
        </Link>
      </div>

      <p role="note" className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950 text-pretty">
        <strong className="block">Draft only — not legal advice.</strong>
        {NOTICE_DISCLAIMER}
      </p>

      <section aria-labelledby="generate-heading" className="flex flex-col gap-4">
        <h2 id="generate-heading" className="text-sm font-medium">
          Generate
        </h2>

        {NOTICE_TYPES.map((type, index) => {
          const preview = previews[index]
          return (
            <div key={type} className="border-input flex flex-col gap-3 rounded-lg border p-4">
              <h3 className="font-medium">{TYPE_LABELS[type]}</h3>

              {!preview.ok ? (
                // The refusal, with its reason. US-27's reconciliation gate is
                // the important one: it means nobody knows what this tenant
                // owes, and no document may state a number.
                <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 text-pretty">
                  <strong className="block">Cannot generate this notice.</strong>
                  {preview.problem.message}
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Claim</dt>
                    <dd className="font-medium">{formatCents(preview.context.claim.totalCents)}</dd>
                    <dt className="text-muted-foreground">Serving to</dt>
                    <dd>
                      {preview.context.address.line1}, {preview.context.address.city}{' '}
                      {preview.context.address.postalCode}
                      {preview.context.address.returnedMailAt && (
                        // US-13: returned mail makes the address visibly stale
                        // everywhere it renders. Serving a lien notice to an
                        // address post already came back from is the exact
                        // failure that AC exists to prevent.
                        <strong className="ml-2 rounded border border-red-300 bg-red-50 px-1 text-xs text-red-900">
                          Mail has come back from this address
                        </strong>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">Template</dt>
                    <dd>Version {preview.context.template.version}</dd>
                  </dl>

                  <details className="text-sm">
                    <summary className="cursor-pointer underline underline-offset-2">
                      Preview the document
                    </summary>
                    {/* The stored document is a document; this is a fragment of
                        it — see renderDocument's note on why the two differ. */}
                    <div
                      className="prose-sm border-input mt-2 max-h-96 overflow-y-auto rounded-md border p-3"
                      dangerouslySetInnerHTML={{ __html: preview.html }}
                    />
                  </details>

                  <form action={generateNoticeAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="type" value={type} />
                    <label className="flex flex-col gap-1 text-sm">
                      Days to pay
                      <input
                        name="deadlineDays"
                        type="number"
                        min={1}
                        defaultValue={DEFAULT_DEADLINE_DAYS}
                        className="border-input bg-background min-h-11 w-28 rounded-md border px-3 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium"
                    >
                      Generate and store
                    </button>
                  </form>
                </>
              )}
            </div>
          )
        })}
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-sm font-medium">
          Generated notices ({notices.length})
        </h2>

        {notices.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing generated for this lease yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notices.map((notice) => (
              <li key={notice.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {TYPE_LABELS[notice.type] ?? notice.type} · {formatCents(notice.claimTotalCents ?? 0)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Generated {formatDate(notice.generatedAt)} · template v{notice.templateVersion} ·
                      pay by {formatDate(notice.deadlineDate)}
                    </p>
                  </div>
                  {/* 1.4.1: status as text, never colour alone. */}
                  {notice.supersededAt ? (
                    <span className="rounded-md border px-2 py-1 text-xs font-medium">Superseded</span>
                  ) : notice.deliveredAt ? (
                    <span className="rounded-md border border-green-300 bg-green-50 px-2 py-1 text-xs font-medium text-green-900">
                      Served
                    </span>
                  ) : (
                    <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
                      Not yet served
                    </span>
                  )}
                </div>

                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Sent to</dt>
                  <dd>{notice.renderedAddress ?? '—'}</dd>
                  <dt className="text-muted-foreground">Document hash</dt>
                  <dd className="font-mono text-xs break-all">{notice.documentHash ?? '—'}</dd>
                  {notice.deliveredAt && (
                    <>
                      <dt className="text-muted-foreground">Served</dt>
                      <dd>
                        {formatDate(notice.deliveredAt)} ·{' '}
                        {notice.deliveryMethod ? DELIVERY_METHOD_LABELS[notice.deliveryMethod] : '—'}
                        {notice.deliveryProof &&
                          Object.entries(notice.deliveryProof).map(([key, value]) => (
                            <span key={key} className="text-muted-foreground block text-xs">
                              {PROOF_LABELS[key] ?? key}: {value}
                            </span>
                          ))}
                      </dd>
                    </>
                  )}
                  {notice.correctsNoticeId && (
                    <>
                      <dt className="text-muted-foreground">Corrects</dt>
                      <dd className="text-xs">An earlier notice, which is now superseded.</dd>
                    </>
                  )}
                </dl>

                {!notice.deliveredAt && !notice.supersededAt && (
                  <form action={recordDeliveryAction} className="mt-3 flex flex-col gap-2 border-t pt-3">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="noticeId" value={notice.id} />
                    <p className="text-sm font-medium">Record how it was served</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1 text-sm">
                        Method
                        <select
                          name="method"
                          className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                        >
                          {NOTICE_DELIVERY_METHODS.map((method) => (
                            <option key={method} value={method}>
                              {DELIVERY_METHOD_LABELS[method]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Date served
                        <input
                          name="deliveredAt"
                          type="date"
                          className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                        />
                      </label>
                    </div>
                    {/* Every proof key any method might need. The action only
                        reads the ones the chosen method requires, so a
                        tracking number cannot end up attached to a hand
                        delivery. */}
                    <div className="flex flex-wrap items-end gap-2">
                      {[...new Set(Object.values(DELIVERY_PROOF_FIELDS).flat())].map((field) => (
                        <label key={field} className="flex flex-col gap-1 text-sm">
                          {PROOF_LABELS[field] ?? field}
                          <input
                            name={field}
                            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                    <p className="text-muted-foreground text-xs text-pretty">
                      Serving by email needs the tenant&apos;s separate notice-by-email consent, and is
                      refused without it.
                    </p>
                    <button
                      type="submit"
                      className="border-input hover:bg-accent min-h-11 self-start rounded-md border px-4 text-sm font-medium"
                    >
                      Record delivery
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
