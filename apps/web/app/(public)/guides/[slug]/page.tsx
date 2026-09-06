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
  guideCopy,
  guideCtaHref,
  guideFilterLabel,
  guidePath,
} from '@/lib/guides/catalog'
import { dictionaryFor, translate, type Locale, type MessageKey } from '@/lib/i18n'

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
/// Taken from a real MDX import rather than hand-written, so the `components`
/// prop below is typed by the loader's own declaration instead of an
/// approximation of it that has to be kept in step.
type MdxModule = typeof import('@/content/guides/packing-tips.mdx')

const CONTENT: Record<Locale, Record<string, () => Promise<MdxModule>>> = {
  en: {
    'what-fits-in-a-10x10': () => import('@/content/guides/what-fits-in-a-10x10.mdx'),
    'moving-checklist': () => import('@/content/guides/moving-checklist.mdx'),
    'packing-tips': () => import('@/content/guides/packing-tips.mdx'),
    'climate-control': () => import('@/content/guides/climate-control.mdx'),
  },
  // B-262. A file per language rather than a dictionary entry per paragraph: a
  // 50-line article is prose, and putting it in `es.ts` would make the message
  // catalogue unreadable for the strings that genuinely belong there. The
  // `Record<Locale, …>` is what makes a missing translation a typecheck failure
  // rather than a Spanish URL that renders English.
  es: {
    'what-fits-in-a-10x10': () => import('@/content/guides/es/what-fits-in-a-10x10.mdx'),
    'moving-checklist': () => import('@/content/guides/es/moving-checklist.mdx'),
    'packing-tips': () => import('@/content/guides/es/packing-tips.mdx'),
    'climate-control': () => import('@/content/guides/es/climate-control.mdx'),
  },
}

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }))
}

/// "17 August 2026", or "17 de agosto de 2026". Forced to UTC: the stored value
/// is a plain date, and formatting it in the server's local zone renders the
/// day before it for anywhere west of Greenwich.
///
/// B-262: one formatter per language rather than one constant, because a
/// guide's date sits inside a translated sentence. The `updated` value it reads
/// is deliberately the same in both — the Spanish page is a translation of this
/// guide, not a second guide, and dating it from the day it was translated
/// would tell a crawler the advice changed when it did not.
const DATE_FORMATS: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }),
  es: new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }),
}

/// An internal link inside a guide's prose, in the language being read.
///
/// The MDX files link with plain, unprefixed paths — `/storage/size-guide` —
/// in both languages, so the Spanish prose is a translation of the English
/// rather than a translation plus a URL scheme. This turns them into whichever
/// locale's URL is being read. An external link (nothing here has one yet, and
/// a guide could gain one) passes straight through: `LocaleLink` only prefixes
/// root-relative paths.
function MdxLink(props: React.ComponentProps<'a'>) {
  const { href, children, ...rest } = props
  if (!href) return <a {...rest}>{children}</a>
  return (
    <LocaleLink href={href} {...rest}>
      {children}
    </LocaleLink>
  )
}

function formatGuideDate(iso: string, locale: Locale): string {
  return DATE_FORMATS[locale].format(new Date(`${iso}T00:00:00Z`))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = guideBySlug(slug)
  if (!guide) {
    return { title: translate(dictionaryFor(await getLocale()), 'guide.notFound') }
  }

  const locale = await getLocale()
  const copy = guideCopy(guide, locale)
  const canonical = guidePath(guide)
  const url = absoluteUrl(siteOrigin(), localePath(locale, canonical))

  return {
    title: copy.title,
    description: copy.description,
    alternates: localeAlternates(locale, canonical),
    openGraph: {
      // `article`, not `website` — this is the one place on the site where that
      // is true, and the type is what a share card uses to decide whether to
      // show a date.
      type: 'article',
      title: copy.title,
      description: copy.description,
      url,
      siteName: SITE.name,
      locale: OPEN_GRAPH_LOCALE[locale],
      publishedTime: guide.published,
      modifiedTime: guide.updated,
    },
    twitter: { card: 'summary_large_image', title: copy.title, description: copy.description },
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = guideBySlug(slug)
  const locale = await getLocale()
  const load = CONTENT[locale][slug]
  if (!guide || !load) notFound()

  const { default: Body } = await load()

  const dict = dictionaryFor(locale)
  const t = (key: MessageKey) => translate(dict, key)
  const copy = guideCopy(guide, locale)
  const canonical = guidePath(guide)
  const url = localeUrl(locale, canonical)
  const filterLabel = guideFilterLabel(guide.filter, locale)

  const schema = [
    articleJsonLd({
      headline: copy.title,
      description: copy.description,
      url,
      datePublished: guide.published,
      dateModified: guide.updated,
      publisher: SITE.name,
    }),
    // AC3's "where appropriate": null for a guide with fewer than two
    // questions, rather than a one-question FAQPage.
    faqPageJsonLd(copy.faqs),
    breadcrumbJsonLd([
      { name: SITE.name, url: localeUrl(locale, '/') },
      { name: t('guide.hubTitle'), url: localeUrl(locale, '/guides') },
      { name: copy.title, url },
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
          {t('guide.allGuides')}
        </LocaleLink>
      </p>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance">{copy.title}</h1>
      <p className="text-muted-foreground mt-3 text-lg text-pretty">{copy.description}</p>

      {/* The same date the `Article` markup reports. On the page as well as in
          the markup, because a reader deciding whether advice is current should
          not have to read the source to find out. */}
      <p className="text-muted-foreground mt-3 text-sm">
        {t('guide.lastUpdated')}{' '}
        <time dateTime={guide.updated}>{formatGuideDate(guide.updated, locale)}</time>
      </p>

      {/* The MDX body. It starts at `##` — the mapping in `mdx-components.tsx`
          renders no `h1`, because this page already has one and a second is a
          1.3.1 failure. */}
      {/* B-262. The prose links to other pages on this site — the size guide,
          the climate-control guide — and an MDX file has no way to know it is
          being read at `/es/...`. Rather than writing `/es/` into the Spanish
          markdown, where it would be one more thing a translator has to
          remember and nothing would catch if they did not, the anchor is
          overridden here: the Spanish and English files carry the SAME hrefs
          and this decides what they mean. */}
      <article className="mt-2">
        <Body components={{ a: MdxLink }} />
      </article>

      {/* US-4 AC3's contextual CTA. It carries the guide's own filter into the
          search, which passes it on to whichever facility the reader picks —
          so a reader who has just been told they want a 10x10 lands on a
          facility page already showing medium units, rather than on a list of
          every size and the same decision again. */}
      <section aria-labelledby="cta" className="mt-10 rounded-lg border p-4">
        <h2 id="cta" className="text-xl font-medium">
          {copy.ctaLabel}
        </h2>
        {filterLabel && (
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            {t('guide.carryFilterBefore')}{' '}
            <strong className="font-medium">{filterLabel}</strong>{' '}
            {t('guide.carryFilterAfter')}
          </p>
        )}
        <p className="mt-4">
          <LocaleLink
            href={guideCtaHref(guide.filter)}
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
          >
            {copy.ctaLabel}
          </LocaleLink>
        </p>
      </section>

      {copy.faqs.length > 0 && (
        <section aria-labelledby="faq" className="mt-10">
          <h2 id="faq" className="text-xl font-medium">
            {t('guide.questionsHeading')}
          </h2>
          {/* Native <details>, same as the facility page: keyboard operable as
              shipped, no JavaScript, and the answers are in the HTML whether or
              not they are open — which is what the FAQPage markup describes. */}
          <div className="mt-4 flex flex-col gap-2">
            {copy.faqs.map((entry) => (
              <details key={entry.question} className="border-input rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">{entry.question}</summary>
                <p className="text-muted-foreground mt-2 text-sm text-pretty">{entry.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        {t('guide.moreBefore')}{' '}
        <LocaleLink href="/guides" className="underline underline-offset-4">
          {t('guide.moreLink')}
        </LocaleLink>
        {t('guide.moreMiddle')}{' '}
        <LocaleLink href="/storage/search" className="underline underline-offset-4">
          {t('guide.moreSearchLink')}
        </LocaleLink>
        .
      </p>
    </div>
  )
}
