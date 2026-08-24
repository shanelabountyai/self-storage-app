import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import {
  activeTimeline,
  exampleTimeline,
  noticeTemplateKeys,
  timelinesFor,
} from '@/lib/admin/delinquency-timeline'
import {
  AUTOMATED_ACTIONS,
  AUTOMATED_ACTION_LABELS,
  DELIVERY_METHODS,
  DELIVERY_METHOD_LABELS,
  PROOF_FIELDS,
  QUALIFYING_AMOUNTS,
  QUALIFYING_AMOUNT_LABELS,
  TIMELINE_DISCLAIMER,
  type TimelineStep,
} from '@storage/core/delinquency'
import { prisma } from '@storage/db'
import { saveTimelineAction } from './actions'

export const metadata = { title: 'Delinquency timeline' }

// PRD 02 §4.6 US-25/US-29 (B-056). The screen where an owner configures what
// happens, and when, to somebody who has not paid.
//
// US-29 governs its tone: "No default timeline is presented as legally
// compliant; defaults are labeled 'example configuration'." The disclaimer is
// persistent rather than dismissible, because the person approving a sale eight
// months from now is not the person reading this today.

const PROOF_LABELS: Record<string, string> = {
  note: 'A note',
  tracking_number: 'Tracking number',
  photo_reference: 'Photo',
  delivered_on: 'Date delivered',
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(value)
}

export default async function DelinquencyTimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ example?: string }>
}) {
  const { example } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above — a timeline is configured per site, because the law that
        governs it is the law of that site&apos;s state.
      </p>
    )
  }
  if (!hasPermissionAnywhere(actor, ['facility:settings'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to this.</p>
  }

  const facilityId = selected.facility.id
  // US-29: "the system requires a facility 'state'". Read here rather than
  // taken from the switcher, which carries only a name — and the state is the
  // single fact that decides which law governs everything on this screen.
  const [versions, active, facility, templateKeys] = await Promise.all([
    timelinesFor(actor, facilityId),
    activeTimeline(facilityId),
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { state: true } }),
    noticeTemplateKeys(facilityId),
  ])

  // The form starts from the active version, or from the example when asked —
  // never from the example by default, so nothing is ever running a timeline
  // nobody chose.
  const starting: { label: string; steps: TimelineStep[] } =
    example === '1'
      ? exampleTimeline()
      : active
        ? { label: active.label, steps: active.steps }
        : { label: '', steps: [] }

  // Blank rows so an operator can add steps without JavaScript. Four is enough
  // for a normal edit and does not make the page unreadable.
  const rows: (TimelineStep | null)[] = [...starting.steps, null, null, null, null]

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Delinquency timeline — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          What happens, and on which day past due, to a tenant who has not paid. Saving creates a
          new version and makes it active; earlier versions are kept because leases record which one
          governed them.
        </p>
      </div>

      {/* US-29. Persistent, not dismissible, and at the top rather than in a
          footer — this is the single most consequential screen in the product
          and the one where a wrong number ends in somebody's property being
          sold. Never colour alone (WCAG 1.4.1): the heading says it. */}
      <div role="note" className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950">
        <p className="font-semibold">This is not legal advice</p>
        <p className="mt-1 text-sm text-pretty">{TIMELINE_DISCLAIMER}</p>
        <p className="mt-2 text-sm">
          This facility is in <span className="font-medium">{facility.state}</span>, and the
          timeline below has not been reviewed against that state&apos;s law by anyone.
        </p>
      </div>

      {!active && (
        <p role="status" className="border-input rounded-lg border p-4 text-sm text-pretty">
          No timeline is configured, so <strong>nothing automatic happens</strong> to a delinquent
          tenant at this facility beyond the separate access-suspension rule. That is deliberate: a
          system that has not been told what this state requires should not be running a lien
          pipeline.{' '}
          <a href="?example=1" className="underline underline-offset-2">
            Load the example configuration
          </a>{' '}
          to start from something and edit it.
        </p>
      )}

      <AdminForm action={saveTimelineAction} label="Delinquency timeline" className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="stepCount" value={rows.length} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="label"
            label="What to call this version"
            defaultValue={starting.label}
            hint="“After the 2026 attorney review”. It is how somebody finds it later."
          />
          <Field
            name="qualifyingAmount"
            label="Paying what halts the pipeline"
            as="select"
            defaultValue={active?.qualifyingAmount ?? 'full_balance'}
          >
            {QUALIFYING_AMOUNTS.map((amount) => (
              <option key={amount} value={amount}>
                {QUALIFYING_AMOUNT_LABELS[amount]}
              </option>
            ))}
          </Field>
        </div>

        {/* D-92 (B-161). Both halves of the same decision, on the same screen
            and referring to each other, because either one alone is a trap: a
            grace window with a day-one restart delays the pipeline twice over,
            and a resume with no grace serves the next notice the morning after
            the bank clawed the money back. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="reversalGraceDays"
            label="Grace after a returned payment"
            type="number"
            min={0}
            max={90}
            defaultValue={String(active?.reversalGraceDays ?? 10)}
            hint="Days before the ladder may move again once a cheque bounces or an ACH is returned. The tenant is holding a receipt; this is how long they get to make it right. 0 means no pause."
          />
          <Field
            name="reversalResumes"
            label="Where the ladder picks up"
            as="select"
            defaultValue={active?.reversalResumes === false ? 'restart' : 'resume'}
            hint="Resuming keeps the notices already served and continues from there. Restarting re-serves every notice from day one, which is kinder and adds the whole ladder to the time before an auction."
          >
            <option value="resume">Resume at the stage already reached</option>
            <option value="restart">Restart at day one and re-serve everything</option>
          </Field>
        </div>

        <div className="flex flex-col gap-4">
          {rows.map((step, index) => (
            <fieldset key={index} className="border-input flex flex-col gap-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">
                Step {index + 1}
                {step ? ` — ${step.label}` : ' (empty)'}
              </legend>

              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <Field
                  name={`day-${index}`}
                  label="Days past due"
                  type="number"
                  min={0}
                  defaultValue={step ? String(step.dayOffset) : ''}
                  hint="Empty removes it."
                />
                <Field name={`label-${index}`} label="Name" defaultValue={step?.label ?? ''} />
              </div>

              <fieldset className="flex flex-wrap gap-3 border-0 p-0">
                <legend className="text-sm">Automatic actions</legend>
                {AUTOMATED_ACTIONS.map((action) => (
                  <label key={action} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`action-${index}`}
                      value={action}
                      defaultChecked={step?.automatedActions.includes(action)}
                      className="size-4"
                    />
                    {AUTOMATED_ACTION_LABELS[action]}
                  </label>
                ))}
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* A picker over templates that exist, not a text box. A typed
                    key that resolves to nothing is a step which reads as
                    "sends a notice" on every screen and sends none — and on a
                    lien timeline that is the gap between a defensible file and
                    a wrongful sale. Saving refuses an unknown key too, so this
                    cannot be worked around by editing the form. */}
                <Field
                  name={`template-${index}`}
                  label="Notice template"
                  as="select"
                  defaultValue={step?.noticeTemplateKey ?? ''}
                  hint="Only templates that exist. Empty means staff send it by hand."
                >
                  <option value="">No notice — staff send it by hand</option>
                  {templateKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </Field>
                <Field
                  name={`task-${index}`}
                  label="Staff task"
                  defaultValue={step?.staffTaskLabel ?? ''}
                  hint="Empty if nobody has to do anything by hand."
                />
              </div>

              <fieldset className="flex flex-wrap gap-3 border-0 p-0">
                <legend className="text-sm">How the notice is delivered</legend>
                {DELIVERY_METHODS.map((method) => (
                  <label key={method} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`delivery-${index}`}
                      value={method}
                      defaultChecked={step?.deliveryMethods.includes(method)}
                      className="size-4"
                    />
                    {DELIVERY_METHOD_LABELS[method]}
                  </label>
                ))}
              </fieldset>

              <fieldset className="flex flex-wrap gap-3 border-0 p-0">
                <legend className="text-sm">Proof the staff task must record</legend>
                {PROOF_FIELDS.map((proof) => (
                  <label key={proof} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`proof-${index}`}
                      value={proof}
                      defaultChecked={step?.requiredProofFields.includes(proof)}
                      className="size-4"
                    />
                    {PROOF_LABELS[proof]}
                  </label>
                ))}
              </fieldset>
            </fieldset>
          ))}
        </div>

        <Button type="submit" className="self-start">
          Save as a new version and activate
        </Button>
      </AdminForm>

      {versions.length > 0 && (
        <section aria-labelledby="versions" className="flex flex-col gap-3">
          <h2 id="versions" className="font-medium">
            Versions
          </h2>
          <ul className="flex flex-col gap-2">
            {versions.map((version) => (
              <li key={version.id} className="border-input rounded-lg border p-3 text-sm">
                <span className="font-medium">
                  v{version.version} — {version.label}
                </span>
                <span className="text-muted-foreground">
                  {version.active ? ' · active' : ''} · {version.steps.length} steps ·{' '}
                  {formatDate(version.createdAt)}
                  {version.createdByName ? ` · ${version.createdByName}` : ''}
                </span>
                {version.leaseCount > 0 && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Governed {version.leaseCount} lease{version.leaseCount === 1 ? '' : 's'} — kept
                    as evidence and never edited.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
