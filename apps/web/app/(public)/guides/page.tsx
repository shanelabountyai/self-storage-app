import Link from 'next/link'
import { SITE } from '@/lib/site-config'
import { absoluteUrl, breadcrumbJsonLd, itemListJsonLd, renderJsonLd } from '@storage/core/marketing'
import { siteOrigin } from '@/lib/marketing/origin'
import { hubEntries } from '@/lib/guides/catalog'

// PRD 04 §3.2 US-4 AC2 (B-082 part 3). The content hub's front page.
//
// Five guides, which is AC2's launch set. Four of them are MDX under
// `content/guides`; the fifth is the size guide, which has lived at
// `/storage/size-guide` since B-016 and is linked rather than re-published —
// copying its text to make the set look uniform would manufacture the
// duplicate content this row's own part 6 exists to warn about (D-60).

const TITLE = 'Storage guides'
const DESCRIPTION =
  'Plain answers to the questions people ask before renting a storage unit: what size you need, what fits, what to pack, and whether climate control is worth it.'

export function generateMetadata() {
  // A function rather than a constant so the absolute OG url comes from
  // `siteOrigin()` — the one place that decides this site's origin — instead of
  // a second reading of the environment that could disagree with the sitemap.
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: '/guides' },
    openGraph: {
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      url: absoluteUrl(siteOrigin(), '/guides'),
      siteName: SITE.name,
      locale: 'en_US',
    },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  }
}

export default function GuidesHubPage() {
  const entries = hubEntries()
  const origin = siteOrigin()

  const schema = [
    itemListJsonLd(
      entries.map((entry) => ({ name: entry.title, url: absoluteUrl(origin, entry.href) })),
      TITLE,
    ),
    breadcrumbJsonLd([
      { name: SITE.name, url: absoluteUrl(origin, '/') },
      { name: TITLE, url: absoluteUrl(origin, '/guides') },
    ]),
  ].filter((node): node is NonNullable<typeof node> => node !== null)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      {schema.map((node, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(node) }}
        />
      ))}

      <h1 className="text-3xl font-semibold tracking-tight text-balance">{TITLE}</h1>
      <p className="text-muted-foreground mt-3 text-lg text-pretty">{DESCRIPTION}</p>

      <ul className="mt-8 flex flex-col gap-4">
        {entries.map((entry) => (
          <li key={entry.href} className="rounded-lg border p-4">
            <h2 className="text-lg font-medium">
              {/* The title is the link, not the card — the same rule the search
                  results and the city page follow, so a screen reader gets a
                  link named after the guide rather than after its summary. */}
              <Link href={entry.href} className="underline underline-offset-4">
                {entry.title}
              </Link>
            </h2>
            <p className="text-muted-foreground mt-2 text-pretty">{entry.description}</p>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        Ready to look at units?{' '}
        <Link href="/storage/search" className="underline underline-offset-4">
          Find storage near you
        </Link>
        .
      </p>
    </div>
  )
}
