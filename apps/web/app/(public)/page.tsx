import Link from 'next/link'
import { FacilitySearchForm } from '@/components/site/facility-search-form'
import { SITE } from '@/lib/site-config'

// Homepage (PRD 01 §6.1). One primary CTA — the search — and nothing competing
// with it. The form submits by GET so the query lands in a shareable URL
// (`/storage/search?q=78704`, US-101).

/// The search form's typeahead lists the places we operate, which means this
/// page now reads the facility registry. Revalidating hourly keeps it
/// prerendered and fast rather than making the homepage render per request —
/// the facility list changes when a site opens, not between page views.
export const revalidate = 3600

const STEPS = [
  { title: 'Find a facility', body: 'Search by zip or city and compare real prices and real availability.' },
  { title: 'Reserve free', body: 'Hold a unit with no card and no account — just your name and a move-in date.' },
  { title: 'Move in online', body: 'Sign the lease, pay, and get your gate code without visiting an office.' },
] as const

export default function HomePage() {
  return (
    <>
      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-20">
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          Storage that you can rent today, without a phone call.
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg text-pretty">
          {SITE.tagline}
        </p>

        <div className="mt-8">
          <FacilitySearchForm />
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <p className="text-muted-foreground text-sm font-medium">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-medium">{step.title}</h3>
                <p className="text-muted-foreground mt-1 text-pretty">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="help-heading" className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 id="help-heading" className="text-2xl font-semibold tracking-tight">
            Not sure what size you need?
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-pretty">
            Most people need less space than they expect. Call{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              {SITE.phone.display}
            </a>{' '}
            and we will talk it through, or read the{' '}
            <Link href="/faq" className="underline underline-offset-4">
              frequently asked questions
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  )
}
