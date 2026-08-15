import { prisma } from '@storage/db'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { simulatorConfigFor } from '@/lib/access/simulator'
import { enterKeypadCodeAction, replayBacklogAction, updateSimulatorConfigAction } from './actions'

// PRD 03 US-7 / FR-8. The virtual keypad: run the entire access lifecycle
// with no hardware. Not in the nav catalog — this is developer/demo tooling
// (US-7's own framing), reachable at this URL for anyone with facility access
// rather than a product surface an operator navigates to.
export const metadata = { title: 'Gate simulator' }

export default async function KeypadDevPage() {
  const { facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above to use the gate simulator.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const [config, recentEvents, pendingBacklog] = await Promise.all([
    simulatorConfigFor(facilityId),
    prisma.accessEvent.findMany({
      where: { facilityId },
      orderBy: { occurredAt: 'desc' },
      take: 10,
    }),
    prisma.simulatedVendorEvent.count({ where: { facilityId, delivered: false } }),
  ])

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Gate simulator — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          Runs the real access-control service end to end with no hardware. A code entered
          here is checked against the mock vendor&apos;s own record — never against our database
          directly — and a real signed webhook is what creates the event below (PRD 03 FR-8).
        </p>
      </div>

      <section aria-labelledby="keypad-heading" className="flex flex-col gap-3">
        <h2 id="keypad-heading" className="text-base font-medium">
          Virtual keypad
        </h2>
        <AdminForm action={enterKeypadCodeAction} label="Enter a gate code" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="code"
            label="Code"
            inputMode="numeric"
            autoComplete="off"
            className="flex w-40 flex-col gap-1 text-sm"
            hint="A real tenant's code from this facility, or anything else to see a denial."
          />
          <Button type="submit">Enter</Button>
        </AdminForm>
      </section>

      <section aria-labelledby="fault-heading" className="flex flex-col gap-3">
        <h2 id="fault-heading" className="text-base font-medium">
          Fault injection
        </h2>
        <p className="text-muted-foreground text-xs text-pretty">
          US-7 AC3. &ldquo;Offline&rdquo; and &ldquo;webhook failing&rdquo; both stop the event from
          reaching us — offline also stops us sending new commands TO the gate (the retry
          queue takes over); webhook-failing only stops us hearing back FROM it. The gate keeps
          deciding granted/denied locally either way, matching how a real standalone keypad keeps
          working with no network.
        </p>
        <AdminForm
          action={updateSimulatorConfigAction}
          label="Fault settings"
          className="flex flex-wrap items-end gap-4"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="offline" value="yes" defaultChecked={config.offline} />
            Gate controller offline
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="webhookFailing"
              value="yes"
              defaultChecked={config.webhookFailing}
            />
            Webhook delivery failing
          </label>
          <Field
            name="latencyMs"
            label="Latency (ms)"
            type="number"
            min="0"
            max="30000"
            defaultValue={config.latencyMs}
            className="flex w-32 flex-col gap-1 text-sm"
          />
          <Button type="submit">Save fault settings</Button>
        </AdminForm>

        <AdminForm action={replayBacklogAction} label="Replay undelivered events" className="mt-1">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Button type="submit" variant="outline" disabled={pendingBacklog === 0}>
            Replay undelivered backlog{pendingBacklog > 0 ? ` (${pendingBacklog})` : ''}
          </Button>
        </AdminForm>
      </section>

      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-base font-medium">
          Recent access events
        </h2>
        {recentEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet — try a code above.</p>
        ) : (
          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">
                    When
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Result
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((event) => (
                  <tr key={event.id} className="border-t">
                    <td className="py-1">{event.occurredAt.toLocaleTimeString()}</td>
                    <td className="py-1 capitalize">{event.result}</td>
                    <td className="py-1">{event.reason.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
