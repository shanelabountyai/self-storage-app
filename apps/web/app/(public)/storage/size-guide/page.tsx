import Link from 'next/link'
import { SITE } from '@/lib/site-config'

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

type Size = {
  label: string
  sqFt: number
  comparison: string
  fits: string[]
  typical: string
}

const SIZES: Size[] = [
  {
    label: '5 × 5',
    sqFt: 25,
    comparison: 'A large closet.',
    fits: ['Boxes and files', 'Seasonal decorations', 'A bike', 'A few small pieces of furniture'],
    typical: 'Students between terms, or clearing one room.',
  },
  {
    label: '5 × 10',
    sqFt: 50,
    comparison: 'A walk-in wardrobe, or half a single garage.',
    fits: ['A mattress set', 'A chest of drawers', 'Boxes', 'A small sofa'],
    typical: 'A studio flat, or one bedroom of furniture.',
  },
  {
    label: '5 × 15',
    sqFt: 75,
    comparison: 'A large walk-in wardrobe.',
    fits: ['The contents of a large bedroom', 'A sofa and armchair', 'Twenty or so boxes'],
    typical: 'A one-bedroom flat without appliances.',
  },
  {
    label: '10 × 10',
    sqFt: 100,
    comparison: 'About half a standard garage.',
    fits: ['A full one-bedroom apartment', 'A sofa, mattress set and dining set', 'A washer and dryer'],
    typical: 'The most-rented size. A one-bedroom home, or a serious declutter.',
  },
  {
    label: '10 × 15',
    sqFt: 150,
    comparison: 'A large single garage.',
    fits: ['A two-bedroom home', 'Major appliances', 'Boxed contents of a loft'],
    typical: 'Moving out of a two-bedroom home.',
  },
  {
    label: '10 × 20',
    sqFt: 200,
    comparison: 'A standard single garage.',
    fits: ['A three-bedroom house', 'A car, with room around it', 'Appliances and garden equipment'],
    typical: 'A whole-house move, or storing a vehicle.',
  },
  {
    label: '10 × 30',
    sqFt: 300,
    comparison: 'A two-car garage.',
    fits: ['A four- or five-bedroom house', 'Commercial stock or equipment', 'A vehicle plus contents'],
    typical: 'Large family moves, and small businesses.',
  },
]

export default function SizeGuidePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        What size storage unit do I need?
      </h1>
      <p className="text-muted-foreground mt-4 text-lg text-pretty">
        Sizes are given in feet — a 10 × 10 unit is ten feet by ten feet. Every unit is the same
        height unless the facility page says otherwise.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {SIZES.map((size) => (
          <section
            key={size.label}
            aria-labelledby={`size-${size.sqFt}`}
            className="rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id={`size-${size.sqFt}`} className="text-xl font-medium">
                {/* The × is a multiplication sign and screen readers announce
                    it as "times", with the unit missing entirely. Sighted
                    readers get the compact form; everyone else gets the
                    sentence. Same treatment as the facility page. */}
                <span aria-hidden="true">{size.label}</span>
                <span className="sr-only">
                  {size.label.replace(' × ', ' foot by ')} foot
                </span>
              </h2>
              <p className="text-muted-foreground text-sm">{size.sqFt} sq ft</p>
            </div>

            <p className="mt-2 font-medium text-pretty">{size.comparison}</p>

            <h3 className="mt-3 text-sm font-medium">Usually holds</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {size.fits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <p className="text-muted-foreground mt-3 text-sm text-pretty">{size.typical}</p>
          </section>
        ))}
      </div>

      <section aria-labelledby="between" className="mt-10">
        <h2 id="between" className="text-xl font-medium">
          If you are between two sizes
        </h2>
        <p className="mt-2 text-pretty">
          Take the larger one. The difference in rent is usually a few dollars a month, and it is a
          great deal cheaper than discovering on moving day that the last of it does not fit. You can
          move to a different size later if you get it wrong.
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
