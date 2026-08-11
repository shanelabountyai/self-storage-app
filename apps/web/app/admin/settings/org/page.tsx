import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { can } from '@/lib/rbac/authorize'
import {
  compareFacilities,
  getOrgDefault,
  templateOverrides,
  type FacilityComparison,
} from '@/lib/admin/org-defaults'
import { ORG_DEFAULT_SCOPE_LABELS, type OverrideReport } from '@storage/core/org'
import { formatCents } from '@/lib/format'
import {
  adoptTimelineDefaultAction,
  pushOrgDefaultAction,
  saveFeeDefaultAction,
  saveLadderDefaultAction,
} from './actions'

export const metadata = { title: 'Org defaults' }

// PRD 02 US-4 (B-079). "Define org-level defaults (fee schedule, notice
// templates, delinquency timeline) and push them to selected facilities, with
// per-facility overrides flagged visibly."
//
// The flag is computed, not stored — see the header of
// packages/core/org/defaults.ts. It says what diverges, not merely that
// something does: "Overridden" alone sends an owner to go and look at twelve
// sites, which is the work this screen exists to save.

const FEE_TYPES = [
  'admin',
  'late',
  'nsf',
  'lien',
  'lock_cut',
  'cleaning',
  'damage',
  'transfer',
  'certified_mail',
  'auction_cost',
] as const

const BASIS_LABELS: Record<string, string> = {
  flat: 'A flat amount',
  percent: 'A percentage of the balance',
  greater: 'The greater of the two',
  lesser: 'The lesser of the two',
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default async function OrgDefaultsPage() {
  const { actor, facilities } = await getSwitcherData()

  // `org:defaults` asked with a null facilityId, which only an all-facilities
  // assignment satisfies — a manager at three sites has no business setting
  // what the other nine charge.
  if (!can(actor, 'org:defaults', null)) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        Org-level defaults are set by an owner, or by a manager assigned to every facility. You can
        still see and change each site&apos;s own settings from{' '}
        <Link href="/admin/settings" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </p>
    )
  }

  const [fees, ladder, timeline, feeRows, ladderRows, timelineRows, templates] = await Promise.all([
    getOrgDefault('fee_schedule'),
    getOrgDefault('late_fee_ladder'),
    getOrgDefault('delinquency_timeline'),
    compareFacilities(actor, 'fee_schedule'),
    compareFacilities(actor, 'late_fee_ladder'),
    compareFacilities(actor, 'delinquency_timeline'),
    templateOverrides(actor),
  ])

  const feeList = (fees?.payload as { fees?: { feeType: string; amountCents: number }[] })?.fees ?? []
  const ladderList =
    (ladder?.payload as {
      ladder?: {
        step: number
        daysPastDue: number
        amountCents: number
        percentBasisPoints: number
        basis: string
        capCents: number | null
      }[]
    })?.ladder ?? []

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Org defaults</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          One agreed fee schedule, late-fee ladder and delinquency timeline for the whole portfolio.
          Editing a default here changes nothing at any facility — a push does, and it writes
          ordinary effective-dated rows into that site&apos;s own settings, exactly as if somebody
          had typed them there.
        </p>
      </header>

      {/* --------------------------------------------------------- fees -- */}
      <section aria-labelledby="fees-heading" className="flex flex-col gap-4">
        <h2 id="fees-heading" className="text-base font-medium">
          {ORG_DEFAULT_SCOPE_LABELS.fee_schedule}
        </h2>

        {feeList.length === 0 ? (
          <p className="text-muted-foreground text-sm">No org fee schedule yet.</p>
        ) : (
          <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            {feeList.map((fee) => (
              <div key={fee.feeType} className="contents">
                <dt className="capitalize">{fee.feeType.replace(/_/g, ' ')}</dt>
                <dd className="text-right font-medium">{formatCents(fee.amountCents)}</dd>
              </div>
            ))}
          </dl>
        )}

        <AdminForm
          action={saveFeeDefaultAction}
          label="Set an org default fee"
          className="grid gap-3 sm:grid-cols-3"
        >
          <Field name="feeType" label="Fee type" as="select" required>
            {FEE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </option>
            ))}
          </Field>
          <Field name="amount" label="Amount (dollars)" type="text" inputMode="decimal" required />
          <div className="flex items-end">
            <Button type="submit">Set default</Button>
          </div>
        </AdminForm>

        <PushPanel scope="fee_schedule" rows={feeRows} configured={feeList.length > 0} />
      </section>

      {/* ------------------------------------------------------- ladder -- */}
      <section aria-labelledby="ladder-heading" className="flex flex-col gap-4">
        <h2 id="ladder-heading" className="text-base font-medium">
          {ORG_DEFAULT_SCOPE_LABELS.late_fee_ladder}
        </h2>

        {ladderList.length === 0 ? (
          <p className="text-muted-foreground text-sm">No org ladder yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {ladderList.map((rule) => (
              <li key={rule.step}>
                <span className="font-medium">Step {rule.step}</span> at {rule.daysPastDue} days
                past due — {BASIS_LABELS[rule.basis] ?? rule.basis}
                {rule.basis !== 'percent' && ` of ${formatCents(rule.amountCents)}`}
                {rule.basis !== 'flat' && ` / ${rule.percentBasisPoints / 100}%`}
                {rule.capCents !== null && `, capped at ${formatCents(rule.capCents)}`}
              </li>
            ))}
          </ul>
        )}

        <AdminForm
          action={saveLadderDefaultAction}
          label="Set an org default ladder step"
          className="grid gap-3 sm:grid-cols-3"
        >
          <Field name="step" label="Step" type="number" min={1} defaultValue={1} required />
          <Field name="daysPastDue" label="Days past due" type="number" min={0} required />
          <Field name="basis" label="How it computes" as="select" required>
            {Object.entries(BASIS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Field>
          <Field name="amount" label="Amount (dollars)" type="text" inputMode="decimal" required />
          <Field name="percent" label="Percent" type="text" inputMode="decimal" defaultValue="0" required />
          <Field
            name="cap"
            label="Cap (dollars)"
            type="text"
            inputMode="decimal"
            hint="Required for anything but a flat amount."
          />
          <div className="flex items-end sm:col-span-3">
            <Button type="submit">Set ladder step</Button>
          </div>
        </AdminForm>

        <PushPanel scope="late_fee_ladder" rows={ladderRows} configured={ladderList.length > 0} />
      </section>

      {/* ----------------------------------------------------- timeline -- */}
      <section aria-labelledby="timeline-heading" className="flex flex-col gap-4">
        <h2 id="timeline-heading" className="text-base font-medium">
          {ORG_DEFAULT_SCOPE_LABELS.delinquency_timeline}
        </h2>

        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {timeline
            ? `The org default is "${timeline.label}".`
            : 'No org default timeline yet.'}{' '}
          Timelines are built on a facility&apos;s own{' '}
          <Link href="/admin/settings/delinquency" className="underline underline-offset-2">
            delinquency settings
          </Link>{' '}
          — where every step is checked against the notice templates that actually exist. Perfect one
          site, then adopt it here.
        </p>

        <AdminForm
          action={adoptTimelineDefaultAction}
          label="Adopt a facility timeline as the org default"
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field name="facilityId" label="Copy the active timeline from" as="select" required>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </Field>
          <div className="flex items-end">
            <Button type="submit">Adopt as org default</Button>
          </div>
        </AdminForm>

        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          A pushed timeline is re-validated against each receiving facility&apos;s own notice
          templates, and refused there if a step names one that site has not written. Nothing about
          a timeline is legal advice.
        </p>

        <PushPanel
          scope="delinquency_timeline"
          rows={timelineRows}
          configured={timeline !== null}
        />
      </section>

      {/* ---------------------------------------------------- templates -- */}
      <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
        <h2 id="templates-heading" className="text-base font-medium">
          Notice and message templates
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Templates need no push. Every facility already uses the org-level version unless it has
          written its own, so the org default is live everywhere below that says &ldquo;org
          default&rdquo;. Pushing would only turn sites that were inheriting into sites that
          override.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {templates.map((row) => (
            <li key={row.facilityId}>
              <span className="font-medium">{row.facilityName}</span>{' '}
              {row.keys.length === 0 ? (
                <span className="text-muted-foreground">— org default throughout</span>
              ) : (
                <span>
                  — overrides {row.keys.length}:{' '}
                  <span className="text-muted-foreground">{row.keys.join(', ')}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function describe(report: OverrideReport): string {
  if (report.matches) return 'Matches the default'
  const parts: string[] = []
  if (report.differences.length > 0) parts.push(`overridden: ${report.differences.join(', ')}`)
  if (report.missing.length > 0) parts.push(`never pushed: ${report.missing.join(', ')}`)
  return parts.join('; ')
}

function PushPanel({
  scope,
  rows,
  configured,
}: {
  scope: string
  rows: FacilityComparison[]
  configured: boolean
}) {
  if (!configured) return null

  return (
    <AdminForm
      action={pushOrgDefaultAction}
      label={`Push the ${scope.replace(/_/g, ' ')} default`}
      className="border-input flex flex-col gap-3 rounded-lg border p-4"
    >
      <input type="hidden" name="scope" value={scope} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Push to</legend>
        {rows.map((row) => (
          <label key={row.facilityId} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="facilityIds"
              value={row.facilityId}
              disabled={!row.canPush}
              className="mt-1"
            />
            <span>
              {row.facilityName}{' '}
              <span
                className={
                  row.report.matches ? 'text-muted-foreground' : 'font-medium text-amber-700'
                }
              >
                — {describe(row.report)}
              </span>
              {!row.canPush && (
                <span className="text-muted-foreground"> (you cannot change this site)</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      <Field
        name="effectiveFrom"
        label="Effective from"
        type="date"
        defaultValue={today()}
        required
        className="flex max-w-xs flex-col gap-1 text-sm"
        hint="Fees and ladder steps are effective-dated, so a push can be scheduled ahead. A timeline takes effect as soon as it is pushed."
      />

      <Button type="submit">Push to the ticked facilities</Button>
    </AdminForm>
  )
}
