import { prisma } from '@storage/db'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { ticketsForFacility } from '@/lib/admin/maintenance'
import { createTicketAction, updateTicketStatusAction } from './actions'

export const metadata = { title: 'Maintenance' }

// PRD 02 §4.9 US-37 (B-060). "Create (from walkthrough, unit page, or
// manually), assign, prioritize, track status." The walkthrough's own findings
// form (US-35) creates tickets through the same `createMaintenanceTicket` —
// this is the screen for creating one directly and for working the open list.

const STATUS_OPTIONS = ['open', 'in_progress', 'blocked', 'done'] as const

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>
}) {
  const { unit: preselectedUnit } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — maintenance tickets are per-site.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const [tickets, units] = await Promise.all([
    ticketsForFacility(actor, facilityId),
    prisma.unit.findMany({ where: { facilityId }, select: { id: true, number: true }, orderBy: { number: 'asc' } }),
  ])

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-lg font-semibold">Maintenance — {selected.facility.name}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Open tickets ({tickets.length})</h2>
        {tickets.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing open.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {ticket.unitNumber} · {ticket.title}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {formatDate(ticket.createdAt)}
                      {ticket.priority === 'high' && <span className="font-medium"> · High priority</span>}
                      {ticket.blocksAvailability && ' · Holding unit off the rentable list'}
                    </p>
                    {ticket.notes && <p className="mt-1 text-sm text-pretty">{ticket.notes}</p>}
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {ticket.assigneeName ? `Assigned to ${ticket.assigneeName}` : 'Unassigned'}
                </p>
                <form action={updateTicketStatusAction} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <label className="sr-only" htmlFor={`status-${ticket.id}`}>
                    Set status for {ticket.title}
                  </label>
                  <select
                    id={`status-${ticket.id}`}
                    name="status"
                    defaultValue={ticket.status}
                    className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="text-sm underline underline-offset-2">
                    Update
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">New ticket</h2>
        <form action={createTicketAction} className="border-input flex flex-col gap-3 rounded-lg border p-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <label className="flex flex-col gap-1 text-sm">
            Unit
            <select
              name="unitId"
              required
              defaultValue={preselectedUnit}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.number}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input
              name="title"
              required
              placeholder="Roll-up door sticks"
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Notes
            <textarea name="notes" className="border-input bg-background rounded-md border px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Priority
            <select name="priority" defaultValue="normal" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm">
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="blocksAvailability" defaultChecked className="h-4 w-4" />
            Hold this unit off the rentable list until it&apos;s fixed
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent min-h-11 self-start rounded-md border px-4 text-sm font-medium"
          >
            Create ticket
          </button>
        </form>
      </section>
    </div>
  )
}
