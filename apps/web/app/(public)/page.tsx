import Link from 'next/link'
import { SITE } from '@/lib/site-config'

// Homepage (PRD 01 §6.1). One primary CTA — the search — and nothing competing
// with it. The results page itself is B-015; this submits to it via GET so the
// query lands in a shareable URL (`/storage/search?q=78704`, US-101).

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

        {/* GET so the result is a bookmarkable URL rather than a POST that
            can't be shared or refreshed (US-101). */}
        <form action="/storage/search" method="GET" className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="q" className="block text-sm font-medium">
              Where do you need storage?
            </label>
            <input
              id="q"
              name="q"
              type="search"
              required
              // Zip is the common case on mobile, so open a numeric keypad —
              // but `inputMode` not `type="number"`, since "Austin, TX" is
              // equally valid input (§6.2).
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="Zip code or city"
              aria-describedby="q-hint"
              className="border-input bg-background mt-1 h-12 w-full rounded-md border px-3 text-base"
            />
            <p id="q-hint" className="text-muted-foreground mt-1 text-sm">
              For example: 78704, or Austin, TX
            </p>
          </div>
          {/* Full-width on mobile, in the thumb zone (§6.1). */}
          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 h-12 rounded-md px-6 text-base font-medium sm:mt-7"
          >
            Find storage
          </button>
        </form>
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
