import Link from 'next/link'
import { AdminForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getAdminActor } from '@/lib/admin/context'
import { can } from '@/lib/rbac/authorize'
import { cityCopyRows, CITY_INTRO_HARD_MAX } from '@/lib/admin/city-copy'
import { citySlugPath } from '@/lib/marketing/paths'
import { cityLabel } from '@/lib/marketing/city-copy'
import { saveCityCopyAction } from './actions'

export const metadata = { title: 'City page copy' }

// PRD 04 §3.2 US-4 AC1 (B-128, D-62). The intro paragraphs on a city landing
// page.
//
// D-58 generated this copy and refused a `City` model, because derived copy
// cannot drift. The measurement that changed the decision is on the screen
// rather than in a commit message: the duplicate-content report scores the
// generated intros at 0.82–0.85 against each other, over this codebase's own
// 0.8 threshold, so the pages built to rank were duplicate content by our own
// check with no field anybody could edit to fix it.
//
// Every city is listed with what it publishes TODAY, generated or written.
// Showing the generated text in place rather than an empty box and a hint is
// what makes "clear it to go back" a claim an operator can check.

export const dynamic = 'force-dynamic'

export default async function CityCopyPage() {
  const actor = await getAdminActor()
  // Asked with a null facility on purpose — a city page spans every facility in
  // the city, so only an all-facilities assignment satisfies it.
  if (!can(actor, 'marketing:city_copy', null)) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        You don&apos;t have access to city page copy. A city page lists every location in the city,
        so editing one is a portfolio-wide permission rather than a per-facility one.
      </p>
    )
  }

  const cities = await cityCopyRows(actor)

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">City page copy</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          The paragraphs at the top of each city landing page. Leave one empty and the page writes
          its own from the facilities in that city — true, but templated, and{' '}
          <Link
            href="/admin/reports/duplicate-content"
            className="underline underline-offset-2"
          >
            the duplicate-content report
          </Link>{' '}
          will keep flagging it against the other cities. This is the box that fixes that.
        </p>
        <p className="text-muted-foreground mt-2 max-w-prose text-sm text-pretty">
          Only cities with an active facility are listed, because a city with none has no page —
          it returns a 404 rather than an empty one.
        </p>
      </div>

      {cities.length === 0 ? (
        <p className="text-muted-foreground text-sm text-pretty">
          No active facilities anywhere yet, so there are no city pages to write for.
        </p>
      ) : (
        cities.map((city) => {
          const label = cityLabel(city.city, city.state)
          const path = citySlugPath(city.state, city.city)

          return (
            <section
              key={`${city.state}/${city.slug}`}
              aria-labelledby={`city-${city.state}-${city.slug}`}
              className="border-input flex flex-col gap-3 rounded-lg border p-4"
            >
              <div>
                <h2 id={`city-${city.state}-${city.slug}`} className="font-medium">
                  {label}
                </h2>
                <p className="text-muted-foreground mt-1 text-xs text-pretty">
                  {city.facilityCount} {city.facilityCount === 1 ? 'location' : 'locations'} ·{' '}
                  {/* Never colour or an icon alone (WCAG 1.4.1) — the word says
                      which state this page is in. */}
                  <span className="font-medium">
                    {city.authored ? 'Written' : 'Generated'}
                  </span>{' '}
                  ·{' '}
                  <Link href={path} className="underline underline-offset-2">
                    See the live page
                  </Link>
                </p>
              </div>

              <div className="bg-muted rounded-md p-3">
                <h3 className="text-xs font-medium">Showing on the page now</h3>
                <div className="mt-1 flex flex-col gap-2 text-sm">
                  {city.rendered.map((paragraph, index) => (
                    <p key={index} className="text-pretty">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>

              <AdminForm
                action={saveCityCopyAction}
                label={`Intro copy for ${label}`}
                className="flex flex-col gap-3"
              >
                {/* The city is named by its stored spelling, which is what the
                    facility records hold — the action re-resolves it against
                    those records, so a posted city nobody operates in is
                    refused rather than written. */}
                <input type="hidden" name="state" value={city.state} />
                <input type="hidden" name="city" value={city.city} />

                <label className="flex flex-col gap-1 text-sm">
                  Intro copy
                  <textarea
                    name="intro"
                    rows={8}
                    defaultValue={city.authored ?? ''}
                    maxLength={CITY_INTRO_HARD_MAX}
                    className="border-input bg-background rounded-md border p-2 text-sm"
                  />
                  <span className="text-muted-foreground text-xs text-pretty">
                    A blank line starts a new paragraph. Write what is true of this city rather
                    than of storage in general — the facility list, the prices and the amenities
                    are already printed below it, so repeating them is the duplication rather than
                    the fix. Empty goes back to the generated copy.
                  </span>
                </label>

                <Button type="submit" className="self-start">
                  Save {label}
                </Button>
              </AdminForm>
            </section>
          )
        })
      )}
    </div>
  )
}
