import Link from 'next/link'
import { SITE } from '@/lib/site-config'

export const metadata = { title: 'Find storage' }

// Placeholder results page. Geocoding, distance ranking, and "units from $X/mo"
// are B-015 (US-101); this exists so the homepage search submits somewhere real
// and the URL is already the shareable shape the AC asks for
// (/storage/search?q=78704) rather than changing later.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {q ? `Storage near ${q}` : 'Find storage'}
      </h1>

      <form action="/storage/search" method="GET" className="mt-6 flex max-w-xl flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="q" className="block text-sm font-medium">
            Zip code or city
          </label>
          <input
            id="q"
            name="q"
            type="search"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            defaultValue={q ?? ''}
            className="border-input bg-background mt-1 h-12 w-full rounded-md border px-3 text-base"
          />
        </div>
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 h-12 rounded-md px-6 text-base font-medium sm:mt-6"
        >
          Search
        </button>
      </form>

      <p className="text-muted-foreground mt-8 text-pretty">
        Search results aren&apos;t switched on yet. In the meantime, call{' '}
        <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
          {SITE.phone.display}
        </a>{' '}
        and we will find you a unit, or read the{' '}
        <Link href="/faq" className="underline underline-offset-4">
          FAQ
        </Link>
        .
      </p>
    </div>
  )
}
