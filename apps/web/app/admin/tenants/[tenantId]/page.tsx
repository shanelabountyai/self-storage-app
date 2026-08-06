import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { tenantProfile } from '@/lib/admin/tenants'
import { formatCents } from '@/lib/format'
import { AdminForm, Field } from '@/components/admin/form'
import {
  addNoteAction,
  flagAddressReturnedAction,
  logDocumentAction,
  setNotePinnedAction,
  updateAddressAction,
  updateContactAction,
  waiveFeeAction,
} from './actions'

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
                  <td className="py-2 capitalize">{lease.status.replace('_', ' ')}</td>
                  <td className="py-2">{formatCents(lease.monthlyRateCents)}/mo</td>
                  <td className={`py-2 text-right tabular-nums ${lease.balanceCents > 0 ? 'font-medium text-red-800' : ''}`}>
                    {formatCents(lease.balanceCents)}
                  </td>
                  <td className="py-2">{formatDate(lease.startDate)}</td>
                  <td className="py-2">
                    {lease.status !== 'ended' && (
                      <Link
                        href={`/admin/tenants/${tenantId}/move-out?lease=${lease.leaseId}`}
                        className="underline underline-offset-2"
                      >
                        Move out
                      </Link>
                    )}
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
                <span className="font-medium">{document.title}</span>{' '}
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

      <section aria-labelledby="comms-heading" className="flex flex-col gap-3">
        <h2 id="comms-heading" className="font-medium">
          Communication history
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.messages.map((message) => (
            <li key={message.id} className="border-input flex justify-between gap-2 rounded-lg border p-3 text-sm">
              <span>
                <span className="font-medium">{message.subjectSnapshot ?? message.templateKey}</span>{' '}
                <span className="text-muted-foreground uppercase">{message.channel}</span>
              </span>
              <span className="text-muted-foreground capitalize">
                {message.status} · {formatWhen(message.createdAt)}
              </span>
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
