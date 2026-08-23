import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@storage/db'
import { leadStatusLabel } from '@storage/core/labels'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getAdminActor } from '@/lib/admin/context'
import { facilityLeads, quoteForFacility } from '@/lib/admin/inquiries'
import { formatCents } from '@/lib/format'
import { holdForLeadAction, joinWaitlistForLeadAction, setLeadStatusAction } from '../actions'

export const metadata = { title: 'Inquiry' }

// PRD 02 US-43 (B-097). The quote and the hold, on the screen the capture form
// lands on — "one click to quote... and one click to place a free hold".
//
// Both prices are shown side by side because the caller always asks what the
// difference is, and a staffer who has to look it up somewhere else has already
// spent the minute the AC budgets for the whole interaction.

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params
  const actor = await getAdminActor()

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, facilityId: true, status: true },
  })
  if (!lead?.facilityId) notFound()

  const [rows, quote] = await Promise.all([
    facilityLeads(actor, lead.facilityId, { includeClosed: true }),
    quoteForFacility(actor, lead.facilityId),
  ])
  const row = rows.find((one) => one.id === leadId)
  if (!row) notFound()

  const held = row.status === 'reserved'

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-sm">
          <Link href="/admin/leads" className="underline underline-offset-2">
            ← All inquiries
          </Link>
        </p>
        <h1 className="mt-2 text-lg font-semibold">{row.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {row.sourceLabel} · {row.phone}
          {row.email ? ` · ${row.email}` : ''}
          {row.takenByName ? ` · taken by ${row.takenByName}` : ''}
        </p>
        {row.message && <p className="mt-2 text-pretty">{row.message}</p>}
        {row.targetMoveInDate && (
          <p className="text-muted-foreground mt-1 text-sm">
            Wants it from{' '}
            {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
              row.targetMoveInDate,
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {row.status !== 'contacted' && !held && (
          <form action={setLeadStatusAction}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="status" value="contacted" />
            <Button type="submit" variant="outline">
              Mark as called back
            </Button>
          </form>
        )}
        {row.status !== 'lost' && (
          <form action={setLeadStatusAction}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="status" value="lost" />
            <Button type="submit" variant="outline">
              Went elsewhere
            </Button>
          </form>
        )}
        <span className="text-muted-foreground self-center text-sm">
          Status: <span className="font-medium">{leadStatusLabel(row.status)}</span>
        </span>
      </div>

      <section aria-labelledby="quote" className="flex flex-col gap-3">
        <h2 id="quote" className="font-medium">
          Quote
        </h2>
        <p className="text-muted-foreground text-xs text-pretty">
          {quote.promotionsAvailable
            ? 'First-period prices below include the promotion the website is currently advertising, so this screen and the website agree.'
            : 'No promotion is running at this facility right now, so nothing here is discounted. If one is running off-system, say so on the call — this screen only knows about promotions set up in Settings.'}
        </p>
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-2xl border-collapse text-sm">
            <caption className="sr-only">Sizes, prices and what today would cost</caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">Size</th>
                <th scope="col" className="py-2 pr-4 text-right">Online</th>
                <th scope="col" className="py-2 pr-4 text-right">In store</th>
                <th scope="col" className="py-2 pr-4 text-right">Due today</th>
                <th scope="col" className="py-2 pr-4 text-right">Available</th>
                <th scope="col" className="py-2 pr-4">Hold</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.unitTypeId} className="border-input border-b">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {line.name}
                    <span className="text-muted-foreground font-normal"> · {line.sqFt} sq ft</span>
                  </th>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatCents(line.webRateCents)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatCents(line.streetRateCents)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(line.moveInTotalCents)}
                    {line.promo && (
                      // Beside the number it modifies rather than in a caption:
                      // the staffer is reading one row down a phone line, and a
                      // discount noted anywhere else is a discount not quoted.
                      <span className="text-muted-foreground mt-0.5 block text-xs font-normal">
                        then {formatCents(line.promo.firstPeriodCents)} first period
                        <span className="block">{line.promo.terms}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{line.availableCount}</td>
                  <td className="py-2 pr-4">
                    {line.availableCount > 0 ? (
                      held ? (
                        <span className="text-muted-foreground">already held</span>
                      ) : (
                        <AdminForm action={holdForLeadAction} label={`Hold a ${line.name}`}>
                          <input type="hidden" name="leadId" value={leadId} />
                          <input type="hidden" name="unitTypeId" value={line.unitTypeId} />
                          <Button type="submit" variant="outline">
                            Hold
                          </Button>
                        </AdminForm>
                      )
                    ) : (
                      // B-154: the identical call about a size we do NOT have
                      // used to capture nothing — notify-me only existed on the
                      // public facility page. Not gated on `held`: a caller can
                      // hold one size and still wait for a better one.
                      <AdminForm
                        action={joinWaitlistForLeadAction}
                        label={`Join the waitlist for a ${line.name}`}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="leadId" value={leadId} />
                        <input type="hidden" name="unitTypeId" value={line.unitTypeId} />
                        <Field
                          name="email"
                          label={<span className="sr-only">Email for the waitlist</span>}
                          type="email"
                          required
                          defaultValue={row.email ?? ''}
                          placeholder="Email"
                          className="flex flex-col gap-1 text-sm"
                        />
                        <Button type="submit" variant="outline">
                          Join waitlist
                        </Button>
                      </AdminForm>
                    )}
                  </td>
                </tr>
              ))}
              {quote.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground py-3">
                    Nothing on sale at this facility.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs text-pretty">
          A hold is free, needs no card and no account, and goes through the same service the
          website uses. It expires on its own — nothing is charged either way. A size with none
          free goes to the waitlist instead — first to complete a rental gets it once we email,
          same as everyone else.
        </p>
      </section>
    </div>
  )
}
