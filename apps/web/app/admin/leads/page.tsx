import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { facilityLeads, quoteForFacility } from '@/lib/admin/inquiries'
import { LEAD_SOURCE_LABELS, STAFF_LEAD_SOURCES } from '@storage/core/metrics'
import { createInquiryAction } from './actions'

export const metadata = { title: 'Inquiries' }

// PRD 02 §4.8 US-43 (B-097). Where a phone call goes.
//
// The form is on this page rather than behind a link, because the target is
// sixty seconds end to end and a page load with somebody on the phone is not
// free. The unit-type list is loaded with it for the same reason — "do you have
// a 10x10" is answered from this screen, not from another one.

function formatWhen(at: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

export default async function LeadsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above — an inquiry belongs to one site.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const [leads, quote] = await Promise.all([
    facilityLeads(actor, facilityId),
    quoteForFacility(actor, facilityId),
  ])
  const overdue = leads.filter((lead) => lead.overdue)

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Inquiries — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Calls, walk-ins and anyone who asked without renting. Roughly half of real rentals start
          here, and a lead that only exists on a sticky note is one the conversion report cannot
          see.
        </p>
      </div>

      <AdminForm action={createInquiryAction} label="New inquiry" className="border-input flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-medium">New inquiry</h2>
        <input type="hidden" name="facilityId" value={facilityId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="firstName" label="First name" />
          <Field name="lastName" label="Last name" />
          <Field name="phone" label="Phone" type="tel" hint="How anyone calls them back." />
          <Field name="email" label="Email (optional)" type="email" />
          <Field name="source" label="How they got here" as="select" defaultValue="phone">
            {STAFF_LEAD_SOURCES.map((source) => (
              <option key={source} value={source}>
                {LEAD_SOURCE_LABELS[source]}
              </option>
            ))}
          </Field>
          <Field name="unitTypeId" label="Size they asked about" as="select" defaultValue="">
            <option value="">Not sure yet</option>
            {quote.lines.map((line) => (
              <option key={line.unitTypeId} value={line.unitTypeId}>
                {line.name} — {line.availableCount} available
              </option>
            ))}
          </Field>
          <Field name="targetMoveInDate" label="When they want it (optional)" type="date" />
        </div>

        <label className="flex flex-col gap-1 text-sm">
          What they said
          <textarea
            name="message"
            rows={2}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
        </label>

        <Button type="submit" className="self-start">
          Save and quote
        </Button>
      </AdminForm>

      <section aria-labelledby="open-heading" className="flex flex-col gap-3">
        <h2 id="open-heading" className="font-medium">
          {overdue.length > 0
            ? `${overdue.length} not called back yet`
            : `${leads.length} open`}
        </h2>

        <ul className="flex flex-col gap-2">
          {leads.map((lead) => (
            <li
              key={lead.id}
              className={
                lead.overdue
                  ? 'rounded-lg border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950'
                  : 'border-input rounded-lg border p-3 text-sm'
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/leads/${lead.id}`} className="font-medium underline underline-offset-2">
                  {lead.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {lead.sourceLabel} · {formatWhen(lead.createdAt)}
                  {/* Never colour alone (WCAG 1.4.1) — the words carry it. */}
                  {lead.overdue && <span className="font-medium"> · not called back</span>}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {lead.phone}
                {lead.unitTypeName ? ` · wants a ${lead.unitTypeName}` : ''}
                {lead.takenByName ? ` · taken by ${lead.takenByName}` : ''}
                {lead.channel ? ` · ${lead.channel.replace(/_/g, ' ')}` : ''}
                {/* FR-LEAD-1's point, made visible: one row, several asks. */}
                {lead.askedTimes > 1 ? ` · asked ${lead.askedTimes} times` : ''}
              </p>
              {lead.message && <p className="mt-1 text-pretty">{lead.message}</p>}
            </li>
          ))}
          {leads.length === 0 && (
            <li className="text-muted-foreground text-sm">
              Nothing open. Every inquiry has a disposition.
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}
