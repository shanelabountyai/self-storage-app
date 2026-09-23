import Link from 'next/link'
import { SITE } from '@/lib/site-config'
import { formatRate } from '@/lib/format'
import { sizeBandFor } from '@/lib/inventory/unit-filters'
import { cachedSizePricing } from '@/lib/inventory/public-inventory'
import {
  dimensionKey,
  dimensionSpoken,
  parseDimension,
  UNIT_SIZES,
  UNIT_SIZE_ORDER,
} from '@storage/core/marketing'

export const metadata = {
  title: 'What size storage unit do I need?',
  description:
    'What fits in a 5x5, 10x10 or 10x20 storage unit, in plain terms — with real-world comparisons for every size we rent.',
}

// PRD 01 US-202. The size guide, as its own crawlable page.
//
// The "size estimator quiz" the story also mentioned is dropped (D-15 round /
// §9): renters do not finish quizzes, they look at a size and picture their
// sofa in it. A good comparison table converts better and costs a tenth as
// much, so this carries the whole job.
//
// No photographs yet. Nothing in the product stores an image and B-067 owns
// photo management *with required alt text*, so illustrations here would either
// ship without alt text or duplicate that item. The written comparisons are the
// part that actually answers the question, and they are what a screen-reader
// user would get from a good alt attribute anyway.

// B-089 moved this catalogue to `@storage/core/marketing`. It did not move for
// tidiness: the per-city/size landing pages need the same comparison and
// "typical" sentences, and those sentences are precisely what makes a
// "10×10 storage units in Austin" page different from the 10×15 page beside it.
// Two copies would drift, and the copy that drifted would be the one nobody
// opens.
//
// D-60 still holds. That decision is about not RE-PUBLISHING the guide, and a
// landing page takes two sentences about its own size and links here for the
// rest — it does not reproduce this page's seven entries.
const SIZES = UNIT_SIZE_ORDER.map((key) => {
  const { widthFt, lengthFt } = parseDimension(key)!
  return { ...UNIT_SIZES[key]!, widthFt, lengthFt, spoken: dimensionSpoken(widthFt, lengthFt) }
})

export default async function SizeGuidePage() {
  // B-366 (D-147). The cheapest current web rate anywhere for each dimension,
  // so the guide states a real starting price rather than the kit's invented
  // one. A size nobody has available today prints no badge — never a
  // fabricated or stale figure.
  const pricing = new Map(
    (await cachedSizePricing()).map((rate) => [dimensionKey(rate.widthFt, rate.lengthFt), rate]),
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        What size storage unit do I need?
      </h1>
      <p className="text-muted-foreground mt-4 max-w-3xl text-lg text-pretty">
        Sizes are given in feet — a 10 × 10 unit is ten feet by ten feet. Every unit is the same
        height unless the facility page says otherwise.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {SIZES.map((size) => {
          const from = pricing.get(dimensionKey(size.widthFt, size.lengthFt))
          return (
            <section
              key={size.label}
              aria-labelledby={`size-${size.sqFt}`}
              className="bg-card rounded-xl border p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id={`size-${size.sqFt}`} className="font-heading text-xl font-bold">
                  {/* The × is a multiplication sign and screen readers announce
                      it as "times", with the unit missing entirely. Sighted
                      readers get the compact form; everyone else gets the
                      sentence. Same treatment as the facility page. */}
                  <span aria-hidden="true">{size.label}</span>
                  <span className="sr-only">{size.spoken}</span>
                </h2>
                <div className="flex items-baseline gap-3">
                  <p className="text-muted-foreground text-sm">{size.sqFt} sq ft</p>
                  {from && (
                    <p className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-sm font-medium">
                      From {formatRate(from.webRateCents)}
                      <span className="font-normal">/mo</span>
                    </p>
                  )}
                </div>
              </div>

              <p className="mt-2 font-medium text-pretty">{size.comparison}</p>

              <h3 className="mt-3 text-sm font-medium">Usually holds</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {size.fits.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <p className="text-muted-foreground mt-3 text-sm text-pretty">{size.typical}</p>

              {/* B-376: the next step from a size. The band travels, and the
                  size is in the link's name (SC 2.4.4). */}
              <p className="mt-3 text-sm">
                <Link
                  href={`/storage/search?size=${sizeBandFor(size.sqFt)}`}
                  className="font-medium underline underline-offset-4"
                >
                  See facilities
                  <span className="sr-only"> with {size.spoken} units</span>
                </Link>
              </p>
            </section>
          )
        })}
      </div>

      <section aria-labelledby="between" className="mt-10 max-w-3xl">
        <h2 id="between" className="text-xl font-medium">
          If you are between two sizes
        </h2>
        <p className="mt-2 text-pretty">
          Take the larger one. Compare the starting prices above; it is a great deal cheaper than
          discovering on moving day that the last of it does not fit. You can move to a different
          size later if you get it wrong.
        </p>
        <p className="mt-4">
          Still not sure?{' '}
          <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
            Call {SITE.phone.display}
          </a>{' '}
          <span className="text-muted-foreground">
            and describe what you have — it takes about a minute.
          </span>
        </p>
        <p className="mt-4">
          <Link href="/storage/search" className="underline underline-offset-4">
            Find storage near you
          </Link>
        </p>
        {/* B-082 part 3. This page is the fifth guide in the hub's launch set
            and it stays at this URL — it has been indexable since B-016 and is
            linked from the facility, search and city pages, so re-publishing
            its text under /guides to make the set look uniform would create the
            duplicate content this row's part 6 exists to warn about (D-60). The
            hub links here; here links back. */}
        <p className="mt-4">
          <Link href="/guides" className="underline underline-offset-4">
            Read the other storage guides
          </Link>
        </p>
      </section>
    </div>
  )
}
