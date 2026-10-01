import Link from 'next/link'
import { prisma } from '@storage/db'
import { AdminForm, Field, FieldSet } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { formatIncidentWhen, INCIDENT_TYPE_LABEL, incidentsForFacility } from '@/lib/admin/incidents'
import { can } from '@/lib/rbac/authorize'
import { recordIncidentAction } from './actions'

export const metadata = { title: 'Incidents' }

// PRD 02 US-37 "an incident is one record" (B-424). The list, and the form
// that records one. The record itself is `/admin/incidents/[id]`.

export default async function IncidentsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return <p className="text-muted-foreground text-sm">Pick a single facility above — incidents are per-site.</p>
  }
  const facilityId = selected.facility.id
  if (!can(actor, 'tenants:edit', facilityId) || !can(actor, 'access:events', facilityId)) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to incidents at this facility.</p>
  }

  const [incidents, units, facility] = await Promise.all([
    incidentsForFacility(actor, facilityId),
    prisma.unit.findMany({ where: { facilityId }, select: { id: true, number: true }, orderBy: { number: 'asc' } }),
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { timezone: true } }),
  ])

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Incidents — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          A break-in, a fire, a flood. One record holds what happened, the units, the police report and the
          gate log for the window, so every affected tenant is told the same thing.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Recorded ({incidents.length})</h2>
        {incidents.length === 0 ? (
          <EmptyState>No incident has been recorded at this facility.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <Card className="p-4">
                  <Link href={`/admin/incidents/${incident.id}`} className="font-medium underline underline-offset-4">
                    {INCIDENT_TYPE_LABEL[incident.type]}, {formatIncidentWhen(incident.windowStart, facility.timezone)}
                  </Link>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {incident.units.length === 1 ? 'Unit' : 'Units'} {incident.units.map((row) => row.unit.number).join(', ')}
                    {' · '}
                    {incident.policeReportNumber ? `Police report ${incident.policeReportNumber}` : 'No police report number yet'}
                  </p>
                  <p className="mt-1 text-sm">{incident.description}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Record an incident</h2>
        <AdminForm action={recordIncidentAction} label="Record an incident" className="flex flex-col gap-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field name="type" label="What happened" as="select" required defaultValue="break_in">
            {Object.entries(INCIDENT_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="windowStart"
              label="Earliest it could have happened"
              type="datetime-local"
              required
              hint="Facility time. The gate log between the two times is copied onto the record and never changes."
            />
            <Field name="windowEnd" label="Latest it could have happened" type="datetime-local" required />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            What is known
            <textarea
              name="description"
              rows={4}
              maxLength={2000}
              required
              className="border-input bg-background rounded-md border p-2 text-sm"
            />
          </label>
          <Field name="policeReportNumber" label="Police report number" maxLength={60} hint="Optional. It can be added later." />
          <FieldSet
            name="unitIds"
            legend="Affected units"
            hint="Each unit’s current tenant gets a task for a member of staff to call them."
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              {units.map((unit) => (
                <Field key={unit.id} name="unitIds" as="checkbox" value={unit.id} label={unit.number} />
              ))}
            </div>
          </FieldSet>
          <Button type="submit">Record the incident</Button>
        </AdminForm>
      </section>
    </div>
  )
}
