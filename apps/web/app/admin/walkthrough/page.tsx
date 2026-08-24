import Link from 'next/link'
import { prisma } from '@storage/db'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { facilityTasks } from '@/lib/admin/tasks'
import { delinquencyQueue } from '@/lib/admin/delinquency-queue'
import { AnnounceRegion } from '@/components/admin/announce'
import { TaskCompleteForm } from '@/components/admin/task-complete-form'
import { reportFindingAction } from './actions'

export const metadata = { title: 'Walkthrough' }

// PRD 02 §4.9 US-35 (B-060). "A mobile-web checklist generated daily per
// facility: overlocks to apply/remove (from delinquency engine), lock checks
// on recently vacated units, space-by-space verification items, and free-form
// findings that convert to maintenance tickets."
//
// Every section here reads an existing list rather than inventing a parallel
// one: overlocks are B-059's own queue, the vacated-unit check is B-014's
// "units awaiting check" screen, and the walk itself is one `Task` per
// facility per day (US-41: every queue is a filtered view of the one list).

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

export default async function WalkthroughPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — the walkthrough is a per-site checklist.
      </p>
    )
  }

  const facilityId = selected.facility.id

  const [delinquency, walkthroughTasks, awaitingCheck, units] = await Promise.all([
    delinquencyQueue(actor, facilityId),
    facilityTasks(actor, facilityId).then((tasks) => tasks.filter((t) => t.type === 'daily_walkthrough')),
    prisma.unit.count({ where: { facilityId, operationalStatus: 'maintenance' } }),
    prisma.unit.findMany({ where: { facilityId }, select: { id: true, number: true }, orderBy: { number: 'asc' } }),
  ])

  const overlockGroups = delinquency.filter((g) => g.type === 'overlock_apply' || g.type === 'overlock_remove')

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Walkthrough — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Today&apos;s checklist for whoever is walking the property.
        </p>
      </div>

      {/* B-170. Completing the walk removes the card the message would have
          been written into, so the region sits above it. */}
      <AnnounceRegion>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Confirm the walk</h2>
        {walkthroughTasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing outstanding for today yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {walkthroughTasks.map((task) => (
              <li
                key={task.id}
                className={task.overdue ? 'rounded-lg border-2 border-red-500 p-4' : 'border-input rounded-lg border p-4'}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">Walkthrough for {formatDate(task.businessDate)}</p>
                  {/* 1.4.1: a skipped day stays visible as text, not just a
                      re-dated row that quietly vanished. */}
                  {task.overdue && (
                    <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-900">
                      Skipped — still open
                    </span>
                  )}
                </div>
                <TaskCompleteForm
                  taskId={task.id}
                  subjectLabel={`Walkthrough for ${formatDate(task.businessDate)}`}
                  notePlaceholder="Walked the property, all clear"
                  buttonLabel="Walked"
                  requiredProofFields={task.requiredProofFields}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      </AnnounceRegion>

      {overlockGroups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Overlocks</h2>
          {overlockGroups.map((group) => (
            <div key={group.type} className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                {group.heading}
              </h3>
              <ul className="flex flex-col gap-2">
                {group.tasks.map((task) => (
                  <li
                    key={task.id}
                    className={task.overdue ? 'rounded-lg border-2 border-red-500 p-3 text-sm' : 'border-input rounded-lg border p-3 text-sm'}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{task.label}</span>
                      {task.overdue && <span className="text-xs font-medium text-red-900">Overdue</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Link href="/admin/overlocks" className="text-sm underline underline-offset-2">
            Full overlock reconciliation
          </Link>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Units awaiting a post-move-out check</h2>
        <p className="text-sm">
          {awaitingCheck === 0 ? (
            <span className="text-muted-foreground">None right now.</span>
          ) : (
            <>
              <span className="font-medium">{awaitingCheck}</span> waiting.{' '}
              <Link href="/admin/units/ready" className="underline underline-offset-2">
                Go check them
              </Link>
            </>
          )}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Report a finding</h2>
        <p className="text-muted-foreground text-sm text-pretty">
          Something wrong with a unit while you were out there. This creates a maintenance ticket.
        </p>
        <form action={reportFindingAction} className="border-input flex flex-col gap-3 rounded-lg border p-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <label className="flex flex-col gap-1 text-sm">
            Unit
            <select
              name="unitId"
              required
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
            What did you find?
            <input
              name="title"
              required
              placeholder="Door won't latch"
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
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
