import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { formatIncidentWhen, INCIDENT_TYPE_LABEL, incidentDetail } from '@/lib/admin/incidents'
import { can } from '@/lib/rbac/authorize'
import { requireStaffActor } from '@/lib/rbac/session'
import { logIncidentDocumentAction, notifyIncidentAction, setPoliceReportAction } from '../actions'

export const metadata = { title: 'Incident' }

// The notify message is CN-21's send loop, so the request has to outlive it.
export const maxDuration = 300

// PRD 02 US-37 "an incident is one record" (B-424). The record: what every
// affected tenant's call is read from.

const ENTRY_METHOD_LABELS = { pin: 'Keypad', mobile_key: 'Phone' } as const

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await requireStaffActor()
  const incident = await incidentDetail(actor, id)
  if (!incident) notFound()
  const timezone = incident.facility.timezone
  const when = (at: Date | string) => formatIncidentWhen(new Date(at), timezone)
  const tenantUnits = incident.units.filter((row) => row.lease)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-sm">
          <Link href="/admin/incidents" className="underline underline-offset-4">
            Incidents
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {INCIDENT_TYPE_LABEL[incident.type]} — {incident.facility.name}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Between {when(incident.windowStart)} and {when(incident.windowEnd)}, facility time. Recorded{' '}
          {when(incident.createdAt)} by {incident.recordedBy.firstName} {incident.recordedBy.lastName}.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">What is known</h2>
        <p className="max-w-prose text-sm whitespace-pre-line">{incident.description}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Affected units ({incident.units.length})</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {incident.units.map((row) => (
            <li key={row.unit.number}>
              Unit {row.unit.number} —{' '}
              {row.lease ? (
                <Link href={`/admin/tenants/${row.lease.tenantId}`} className="underline underline-offset-2">
                  {row.lease.tenant.firstName} {row.lease.tenant.lastName}
                </Link>
              ) : (
                <span className="text-muted-foreground">vacant when recorded</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          Each tenant has a task under{' '}
          <Link href="/admin/tasks" className="underline underline-offset-2">
            Tasks
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Police report</h2>
        <AdminForm action={setPoliceReportAction} label="Police report number" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="incidentId" value={incident.id} />
          <Field name="policeReportNumber" label="Police report number" maxLength={60} defaultValue={incident.policeReportNumber ?? ''} />
          <Button type="submit" variant="outline">
            Save the number
          </Button>
        </AdminForm>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Gate log for the window ({incident.gateLogExcerpt.length})</h2>
        <p className="text-muted-foreground text-xs">
          Copied when the incident was recorded. Events that arrive later are not added, and it cannot be edited.
        </p>
        {incident.gateLogExcerpt.length === 0 ? (
          <EmptyState>The gate recorded nothing in the window.</EmptyState>
        ) : (
          <ScrollRegion aria-label="Gate log for the window">
            <table className="w-full min-w-xl border-collapse text-sm">
              <caption className="sr-only">Gate attempts inside the incident window, oldest first</caption>
              <thead>
                <tr className="border-input border-b text-left">
                  {['When', 'Who', 'Unit', 'How', 'Result'].map((heading) => (
                    <th key={heading} scope="col" className="py-2 pr-4">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incident.gateLogExcerpt.map((row, index) => (
                  <tr key={index} className="border-input border-b">
                    <td className="py-2 pr-4 whitespace-nowrap">{when(row.occurredAt)}</td>
                    <td className="py-2 pr-4">{row.tenantName ?? <span className="text-muted-foreground">Unknown</span>}</td>
                    <td className="py-2 pr-4">{row.unitNumber ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 pr-4">{row.entryMethod ? ENTRY_METHOD_LABELS[row.entryMethod] : '—'}</td>
                    {/* The result is a word, never a colour alone (WCAG 1.4.1). */}
                    <td className="py-2 pr-4">
                      {row.result === 'granted' ? 'Opened' : 'Denied'}
                      <span className="text-muted-foreground"> · {row.reason.replaceAll('_', ' ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Photos and documents ({incident.documents.length})</h2>
        {incident.documents.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {incident.documents.map((document) => (
              <li key={document.id}>
                {document.type === 'inspection_photo' ? 'Photo' : 'Document'}: {document.title}
                {document.content && <span className="text-muted-foreground"> — {document.content}</span>}
              </li>
            ))}
          </ul>
        )}
        <AdminForm action={logIncidentDocumentAction} label="Add a photo or document" className="flex flex-col gap-3">
          <input type="hidden" name="incidentId" value={incident.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="type" label="Kind" as="select" defaultValue="inspection_photo">
              <option value="inspection_photo">Photo</option>
              <option value="other">Document</option>
            </Field>
            <Field name="title" label="What it shows" required maxLength={120} className="flex flex-col gap-1 text-sm sm:col-span-2" />
          </div>
          <Field
            name="note"
            label="Where it is kept"
            maxLength={500}
            hint="This records that it exists. The file itself stays where you say it is."
          />
          <Button type="submit" variant="outline" className="self-start">
            Add it to the incident
          </Button>
        </AdminForm>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Tell the affected tenants</h2>
        {incident.notifiedAt ? (
          <p className="text-sm">
            Sent {when(incident.notifiedAt)}. It is under{' '}
            <Link href="/admin/messages" className="underline underline-offset-2">
              Messages
            </Link>
            , and it cannot be sent again.
          </p>
        ) : tenantUnits.length === 0 ? (
          <p className="text-muted-foreground text-sm">No affected unit had a tenant, so there is nobody to tell.</p>
        ) : !can(actor, 'comms:broadcast', incident.facilityId) ? (
          <p className="text-muted-foreground text-sm">Sending the message needs the announcements permission.</p>
        ) : (
          <AdminForm action={notifyIncidentAction} label="Tell the affected tenants" className="flex flex-col gap-3">
            <input type="hidden" name="incidentId" value={incident.id} />
            <p className="text-muted-foreground text-xs text-pretty">
              One operational notice to the tenants of {tenantUnits.length === 1 ? 'unit' : 'units'}{' '}
              {tenantUnits.map((row) => row.unit.number).join(', ')}. It can be sent once.
            </p>
            <Field name="subject" label="Subject" required maxLength={120} />
            <label className="flex flex-col gap-1 text-sm">
              Message
              <textarea name="message" rows={5} maxLength={2000} required className="border-input bg-background rounded-md border p-2 text-sm" />
            </label>
            <Button type="submit" className="self-start">
              Review the message
            </Button>
          </AdminForm>
        )}
      </section>
    </div>
  )
}
