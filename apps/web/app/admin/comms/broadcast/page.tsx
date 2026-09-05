import Link from 'next/link'
import { AdminForm, Field, FieldSet } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import {
  BROADCAST_MAX_RECIPIENTS,
  broadcastAudience,
  broadcastBuildings,
  broadcastTemplateOptions,
} from '@/lib/admin/broadcast'
import { sendBroadcastAction } from './actions'

export const metadata = { title: 'Announcements' }

// A broadcast to a whole site is bounded work, but it is a few hundred
// sequential provider round trips and the request has to outlive them. The
// cron route already runs at this ceiling for the same reason.
export const maxDuration = 300

// PRD 05 CN-21 (B-090 part 4). "Power outage today", to everyone it affects.
//
// ── Why there is no live recipient count on this page ───────────────────────
//
// The count that matters is computed at the moment of the press, inside the
// action, and shown in the confirm step — never rendered here from an earlier
// filter. B-173 is the reason: four screens priced a settlement from the URL
// and committed something else, because the preview and the commit read
// different inputs. A page that showed "143 tenants" beside a building filter
// the operator then changed would be the same defect with a much worse
// outcome, since the wrong answer here is an email that cannot be recalled.
// The figure below is the whole site's, and says so.

export default async function BroadcastPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (!hasPermissionAnywhere(actor, ['comms:broadcast'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to announcements.</p>
  }
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above. An announcement goes to one site&apos;s tenants — there is no
        portfolio-wide send, deliberately.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const [templates, buildings, everyone] = await Promise.all([
    broadcastTemplateOptions(actor, facilityId),
    broadcastBuildings(actor, facilityId),
    broadcastAudience(actor, facilityId, {}),
  ])

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Announcements — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          One message to current tenants at this site. It is logged, and every tenant&apos;s
          preferences, unsubscribes and quiet hours are applied the same way they are on automatic
          messages — so the number that goes out can be smaller than the number here.
        </p>
        <p className="mt-2 text-sm">
          This site has <strong>{everyone.length}</strong>{' '}
          {everyone.length === 1 ? 'current tenant' : 'current tenants'} with a lease. Filters below
          narrow that; the exact number is shown for confirmation before anything sends.
        </p>
      </div>

      {templates.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No announcement templates are published yet.
        </p>
      ) : (
        <AdminForm action={sendBroadcastAction} label="Send an announcement" className="flex flex-col gap-4">
          <input type="hidden" name="facilityId" value={facilityId} />

          <FieldSet
            name="templateKey"
            legend="What kind of message is this?"
            hint="This decides the rules it is sent under, and it is not a formatting choice."
          >
            {templates.map((template, index) => (
              <Field
                key={template.key}
                name="templateKey"
                as="radio"
                value={template.key}
                defaultChecked={index === 0}
                label={
                  template.classification === 'marketing'
                    ? 'An offer or promotion'
                    : 'An operational notice'
                }
                hint={
                  template.classification === 'marketing'
                    ? 'Carries an unsubscribe link, is held back outside 8am–9pm, and is not sent to anyone who has unsubscribed or already had a marketing email today.'
                    : 'Gate closures, roadworks, office hours, a water leak. Goes out at any hour, and only tenants who have switched operational notices off in their account are skipped.'
                }
              />
            ))}
          </FieldSet>

          <Field
            name="subject"
            label="Subject"
            required
            maxLength={120}
            hint="What tenants see in their inbox. Say the thing: “Gate closed Thursday morning”."
          />

          <label className="flex flex-col gap-1 text-sm">
            Message
            <textarea
              name="message"
              rows={8}
              required
              maxLength={2000}
              className="border-input bg-background rounded-md border p-2 text-sm"
            />
            <span className="text-muted-foreground text-xs text-pretty">
              The greeting, the sign-off and this site&apos;s name and address are added around it.
              Edit that wrapper under{' '}
              <Link href="/admin/settings/templates" className="underline underline-offset-4">
                Settings → Message templates
              </Link>
              .
            </span>
          </label>

          <fieldset className="border-input flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Who gets it</legend>
            <p className="text-muted-foreground text-xs text-pretty">
              Leave both blank to reach every current tenant at this site. Capped at{' '}
              {BROADCAST_MAX_RECIPIENTS} tenants per announcement.
            </p>

            {buildings.length > 0 && (
              <Field name="building" label="Building" as="select" defaultValue="">
                <option value="">Every building</option>
                {buildings.map((building) => (
                  <option key={building} value={building}>
                    {building}
                  </option>
                ))}
              </Field>
            )}

            <Field
              name="unitNumbers"
              label="Specific units"
              hint="Unit numbers, separated by commas — A-12, B-04. Use this to write to one tenant. Only units with a current lease are reachable."
            />
          </fieldset>

          <div>
            <Button type="submit">Review and send</Button>
          </div>
        </AdminForm>
      )}

      <section aria-labelledby="frame-heading">
        <h2 id="frame-heading" className="text-sm font-medium">
          What the email looks like
        </h2>
        <p className="text-muted-foreground mt-1 text-xs text-pretty">
          Your subject and message drop into the two marked places. Everything else is the template.
        </p>
        <div className="mt-2 flex flex-col gap-3">
          {templates.map((template) => (
            <div key={template.key} className="border-input rounded-lg border p-3 text-xs">
              <p className="font-medium">
                {template.classification === 'marketing' ? 'An offer or promotion' : 'An operational notice'}
                {template.isOverride && (
                  <span className="text-muted-foreground font-normal"> · this site&apos;s own wording</span>
                )}
              </p>
              <pre className="mt-2 whitespace-pre-wrap font-sans">
                {template.subject}
                {'\n\n'}
                {template.bodyText}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
