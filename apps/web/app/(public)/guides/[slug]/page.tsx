import { LocaleLink } from '@/components/site/locale-link'
import { notFound } from 'next/navigation'
import { SITE } from '@/lib/site-config'
import {
  absoluteUrl,
  articleJsonLd,
  breadcrumbJsonLd,
  faqPageJsonLd,
  renderJsonLd,
} from '@storage/core/marketing'
import { siteOrigin } from '@/lib/marketing/origin'
import { getLocale } from '@/lib/i18n/server'
import { OPEN_GRAPH_LOCALE, localePath } from '@/lib/i18n/routing'
import { localeAlternates, localeUrl } from '@/lib/marketing/alternates'
import {
  GUIDES,
  guideBySlug,
  guideCtaHref,
  guideFilterLabel,
  guidePath,
} from '@/lib/guides/catalog'

// PRD 04 §3.2 US-4 AC2/AC3 (B-082 part 3). One guide from the content hub.
//
// The prose is MDX under `content/guides`; everything a machine reads about the
// guide is typed in `lib/guides/catalog.ts`. This route is what joins them and
// adds the parts a markdown file cannot carry: the `Article` and `FAQPage`
// markup, the breadcrumb, and AC3's contextual CTA.
//
// Statically generated (FR-SEO-1). Nothing on this page reads the database or
// the request — a guide is the same for everybody — so there is no reason for
// it to cost a render per visit.

/// Slug → prose. Separate from the catalog because only this file is compiled
/// by the MDX loader, and because a bundler needs these specifiers written out
/// rather than built from a variable.
///
/// A slug in `GUIDES` with no entry here 404s rather than throwing, and the
/// e2e suite walks every slug in `GUIDES` — so the two drifting apart is a red
/// test rather than a page that dies in production.
const CONTENT: Record<string, () => Promise<{ default: React.ComponentType }>> = {
  'what-fits-in-a-10x10': () => import('@/content/guides/what-fits-in-a-10x10.mdx'),
  'moving-checklist': () => import('@/content/guides/moving-checklist.mdx'),
  'packing-tips': () => import('@/content/guides/packing-tips.mdx'),
  'climate-control': () => import('@/content/guides/climate-control.mdx'),
}

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }))
}

/// "17 August 2026". Forced to UTC: the stored value is a plain date, and
/// formatting it in the server's local zone renders the day before it for
/// anywhere west of Greenwich.
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatGuideDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = guideBySlug(slug)
  if (!guide) return { title: 'Guide not found' }

  const locale = await getLocale()
  const canonical = guidePath(guide)
  const url = absoluteUrl(siteOrigin(), localePath(locale, canonical))

  return {
    title: guide.title,
    description: guide.description,
    alternates: localeAlternates(locale, canonical),
    openGraph: {
      // `article`, not `website` — this is the one place on the site where that
      // is true, and the type is what a share card uses to decide whether to
      // show a date.
      type: 'article',
      title: guide.title,
      description: guide.description,
      url,
      siteName: SITE.name,
      locale: OPEN_GRAPH_LOCALE[locale],
      publishedTime: guide.published,
      modifiedTime: guide.updated,
    },
    twitter: { card: 'summary_large_image', title: guide.title, description: guide.description },
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = guideBySlug(slug)
  const load = CONTENT[slug]
  if (!guide || !load) notFound()

  const { default: Body } = await load()

  const locale = await getLocale()
  const canonical = guidePath(guide)
  const url = localeUrl(locale, canonical)
  const filterLabel = guideFilterLabel(guide.filter)

  const schema = [
    articleJsonLd({
      headline: guide.title,
      description: guide.description,
      url,
      datePublished: guide.published,
      dateModified: guide.updated,
      publisher: SITE.name,
    }),
    // AC3's "where appropriate": null for a guide with fewer than two
    // questions, rather than a one-question FAQPage.
    faqPageJsonLd(guide.faqs),
    breadcrumbJsonLd([
      { name: SITE.name, url: localeUrl(locale, '/') },
      { name: 'Storage guides', url: localeUrl(locale, '/guides') },
      { name: guide.title, url },
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

      <p className="text-muted-foreground text-sm">
        <LocaleLink href="/guides" className="underline underline-offset-4">
          ← All guides
        </LocaleLink>
      </p>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance">{guide.title}</h1>
      <p className="text-muted-foreground mt-3 text-lg text-pretty">{guide.description}</p>

      {/* The same date the `Article` markup reports. On the page as well as in
          the markup, because a reader deciding whether advice is current should
          not have to read the source to find out. */}
      <p className="text-muted-foreground mt-3 text-sm">
        Last updated <time dateTime={guide.updated}>{formatGuideDate(guide.updated)}</time>
      </p>

      {/* The MDX body. It starts at `##` — the mapping in `mdx-components.tsx`
          renders no `h1`, because this page already has one and a second is a
          1.3.1 failure. */}
      <article className="mt-2">
        <Body />
      </article>

      {/* US-4 AC3's contextual CTA. It carries the guide's own filter into the
          search, which passes it on to whichever facility the reader picks —
          so a reader who has just been told they want a 10x10 lands on a
          facility page already showing medium units, rather than on a list of
          every size and the same decision again. */}
      <section aria-labelledby="cta" className="mt-10 rounded-lg border p-4">
        <h2 id="cta" className="text-xl font-medium">
          {guide.ctaLabel}
        </h2>
        {filterLabel && (
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            We will carry the <strong className="font-medium">{filterLabel}</strong> filter through
            to the facility you pick.
          </p>
        )}
        <p className="mt-4">
          <LocaleLink
            href={guideCtaHref(guide.filter)}
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
          >
            {guide.ctaLabel}
          </LocaleLink>
        </p>
      </section>

      {guide.faqs.length > 0 && (
        <section aria-labelledby="faq" className="mt-10">
          <h2 id="faq" className="text-xl font-medium">
            Questions people ask
          </h2>
          {/* Native <details>, same as the facility page: keyboard operable as
              shipped, no JavaScript, and the answers are in the HTML whether or
              not they are open — which is what the FAQPage markup describes. */}
          <div className="mt-4 flex flex-col gap-2">
            {guide.faqs.map((entry) => (
              <details key={entry.question} className="border-input rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">{entry.question}</summary>
                <p className="text-muted-foreground mt-2 text-sm text-pretty">{entry.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        More in the{' '}
        <LocaleLink href="/guides" className="underline underline-offset-4">
          storage guides
        </LocaleLink>
        , or{' '}
        <LocaleLink href="/storage/search" className="underline underline-offset-4">
          find storage near you
        </LocaleLink>
        .
      </p>
    </div>
  )
}
