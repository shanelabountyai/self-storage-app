import type { Metadata } from 'next'
import { AdminForm, Field } from '@/components/admin/form'
import { requireTenantActor } from '@/lib/rbac/session'
import { authorizedAccessForTenant } from '@/lib/portal/authorized-access'
import { currentImpersonation } from '@/lib/impersonation/context'
import { SHARED_ACCESS_PRESETS } from '@storage/core/access'
import { addPersonAction, revokePersonAction } from './actions'

export const metadata: Metadata = { title: 'Who can get in' }

// PRD 03 US-9 AC4 (B-105). The tenant's own authorized-access list.
//
// The heading is "Who can get in" rather than "Authorized access list" for a
// reason US-9 itself gives: the failure this feature exists to stop is a tenant
// handing their code around, which destroys the gate log's evidentiary value at
// exactly the moment a theft claim needs it. A screen somebody understands at a
// glance is the one they use instead of texting their code to a contractor.

export default async function AccessPage() {
  const actor = await requireTenantActor()
  const [loaded, impersonation] = await Promise.all([
    authorizedAccessForTenant(actor.tenantId),
    currentImpersonation(),
  ])

  // PRD 09 FR-12 (B-091 part 2). Same rule as the tenant's own code on
  // /portal: an impersonated session never renders a gate code, and the code is
  // dropped from the data rather than hidden in the markup so it is not
  // serialised into the page at all.
  const units = impersonation
    ? loaded.map((unit) => ({ ...unit, people: unit.people.map((p) => ({ ...p, code: null })) }))
    : loaded

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Who can get in</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Anyone you add gets their <strong>own</strong> gate code, not a copy of yours. The gate log
          records who actually came in, and you can withdraw one person&apos;s code at any time
          without changing your own.
        </p>
      </header>

      {units.length === 0 && (
        <p className="text-muted-foreground text-sm">You don&apos;t have any units right now.</p>
      )}

      {units.map((unit) => (
        <section
          key={unit.leaseId}
          aria-labelledby={`unit-${unit.leaseId}`}
          className="border-input flex flex-col gap-4 rounded-lg border p-4"
        >
          <h2 id={`unit-${unit.leaseId}`} className="font-medium">
            Unit {unit.unitNumber}
            <span className="text-muted-foreground font-normal"> · {unit.facilityName}</span>
          </h2>

          {unit.tenantSuspended && (
            // Said before the form rather than after the submit. Anyone added
            // now starts suspended, and letting somebody hand out a code that
            // does not work is worse than telling them why.
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
              Access to this unit is switched off while the balance is unpaid. Anyone you add now
              will not be able to get in until it is cleared — and neither can the people already on
              this list.
            </p>
          )}

          {unit.people.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nobody else can get into this unit at the moment.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {unit.people.map((person) => (
                <li
                  key={person.id}
                  className="border-input flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{person.name}</p>
                    <p className="text-muted-foreground">
                      {person.relationship} · {person.phone}
                    </p>
                    <p className="text-muted-foreground">
                      {person.hoursLabel}
                      {person.expiresOn && ` · until ${formatDay(person.expiresOn)}`}
                    </p>
                    {person.code ? (
                      <p className="mt-1">
                        Their code: <span className="font-mono font-medium">{person.code}</span>
                      </p>
                    ) : impersonation ? (
                      <p className="text-muted-foreground mt-1">
                        Codes are hidden during a support session.
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-1">
                        Call the office for their code.
                      </p>
                    )}
                    {person.suspended && !unit.tenantSuspended && (
                      <p className="mt-1 text-amber-700">Their code is switched off.</p>
                    )}
                    {!person.addedByTenant && (
                      <p className="text-muted-foreground mt-1 text-xs">Added at the office.</p>
                    )}
                  </div>

                  <AdminForm action={revokePersonAction} label={`Withdraw access for ${person.name}`}>
                    <input type="hidden" name="personId" value={person.id} />
                    <input type="hidden" name="name" value={person.name} />
                    <button type="submit" className="text-sm underline underline-offset-4">
                      Withdraw access
                    </button>
                  </AdminForm>
                </li>
              ))}
            </ul>
          )}

          {unit.people.length >= unit.cap ? (
            <p className="text-muted-foreground text-sm text-pretty">
              You have the most people this facility allows ({unit.cap}). Withdraw somebody to add
              another, or call the office.
            </p>
          ) : (
            <details className="border-input rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">Add someone</summary>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">
                They will get their own code, which we will show you once you add them. You can have
                up to {unit.cap} people on this unit.
              </p>
              <AdminForm
                action={addPersonAction}
                label={`Add someone to unit ${unit.unitNumber}`}
                className="mt-3 grid gap-3 sm:grid-cols-3"
              >
                <input type="hidden" name="leaseId" value={unit.leaseId} />
                <Field
                  name="name"
                  label="Full name"
                  type="text"
                  required
                  autoComplete="off"
                  className="flex flex-col gap-1 text-sm"
                />
                <Field
                  name="phone"
                  label="Phone"
                  type="tel"
                  required
                  autoComplete="off"
                  className="flex flex-col gap-1 text-sm"
                />
                <Field
                  name="relationship"
                  label="Who they are to you"
                  type="text"
                  required
                  autoComplete="off"
                  hint="For example: spouse, employee, brother."
                  className="flex flex-col gap-1 text-sm"
                />
                {/* US-8 AC1's scope. Both optional and both defaulted to the
                    unrestricted answer: the common case is still "my brother,
                    no limits", and a tenant made to answer two questions they
                    did not ask goes back to texting their own code. */}
                <Field
                  name="accessHours"
                  label="When they can get in"
                  as="select"
                  defaultValue="anytime"
                  className="flex flex-col gap-1 text-sm"
                >
                  {Object.entries(SHARED_ACCESS_PRESETS).map(([value, preset]) => (
                    <option key={value} value={value}>
                      {preset.label}
                    </option>
                  ))}
                </Field>
                <Field
                  name="expiresOn"
                  label="Last day (optional)"
                  type="date"
                  min={unit.today}
                  autoComplete="off"
                  hint="Leave blank and their code works until you withdraw it."
                  className="flex flex-col gap-1 text-sm"
                />
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
                  >
                    Add them
                  </button>
                </div>
              </AdminForm>
            </details>
          )}
        </section>
      ))}
    </div>
  )
}

/// An absolute facility-local day, spelled out. Never a countdown — PRD 01
/// §6.8.1.
function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
