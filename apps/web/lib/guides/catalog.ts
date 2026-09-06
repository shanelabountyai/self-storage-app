import type { FaqEntry } from '@storage/core/marketing'
import { dictionaryFor, type Locale } from '@/lib/i18n'
import {
  FEATURE_FILTERS,
  SIZE_BANDS,
  type FeatureKey,
  type SizeBand,
} from '@/lib/inventory/unit-filters'

// PRD 04 §3.2 US-4 AC2/AC3 (B-082 part 3). The content hub's index of guides.
//
// The split this file exists to make: a guide's PROSE lives in
// `content/guides/{slug}.mdx`, and everything a machine reads about it lives
// here, typed. `Article` JSON-LD needs a headline, a description and two dates;
// frontmatter would let a guide ship without them and fail silently as absent
// markup, whereas a missing field here is a build error.
//
// It also means the CTA a guide carries (AC3) is checked. `size` and `feature`
// are the real filter vocabularies from `unit-filters`, so a guide cannot point
// a reader at `?size=extra-large` — a URL that renders a page with the filter
// quietly ignored, which is indistinguishable from a working link until
// somebody counts conversions.

/// AC3's "contextual CTA": the filter this guide's advice lands on.
///
/// Both optional and both typed. A guide about packing has no filter to offer
/// and says so by carrying neither, rather than by pointing at a default.
export type GuideFilter = { size?: SizeBand; feature?: FeatureKey }

/// B-262. Everything about a guide that is WORDS, in one language.
///
/// Split out of `Guide` rather than added beside it as `titleEs`, `descriptionEs`
/// and so on, because the set is what has to be complete: a guide with a Spanish
/// title and an English CTA is a page that switches language halfway down, and
/// four parallel optional fields is exactly the shape that lets that ship. As a
/// `Record<Locale, GuideCopy>` a new locale fails typecheck until every field of
/// it exists — the same guarantee `Dictionary` gives the message catalogue.
export type GuideCopy = {
  title: string
  /// One string for the meta description, the hub card and the `Article`
  /// description. Two would drift, and the card is what a reader judges the
  /// guide by before a search snippet ever renders.
  description: string
  /// The sentence above the CTA button. Written per guide because "Find
  /// storage near you" under every one of them is the CTA a reader stops
  /// seeing.
  ctaLabel: string
  /// US-4 AC3's `FAQPage` "where appropriate" — present only where the guide
  /// genuinely answers repeated questions. `faqPageJsonLd` refuses fewer than
  /// two, so a guide with one question emits no markup rather than a
  /// single-question FAQPage, which is the shape Google ignores.
  ///
  /// Translated per language, and the JSON-LD follows: an `FAQPage` on the
  /// Spanish URL carrying English questions describes a page that does not
  /// exist, and it is the rich result a Spanish searcher would have clicked.
  faqs: FaqEntry[]
}

export type Guide = {
  slug: string
  /// ISO dates. `updated` is what `Article.dateModified` reports, so it is
  /// changed by hand when the words change — a build timestamp would tell a
  /// crawler every guide changed on every deploy.
  ///
  /// One pair for both languages, deliberately. The translation is of the same
  /// guide, not a second one — dating the Spanish version from the day it was
  /// translated would tell a crawler the advice changed when it did not.
  published: string
  updated: string
  filter: GuideFilter
  copy: Record<Locale, GuideCopy>
}

/// A guide's words in the language being read.
export function guideCopy(guide: Guide, locale: Locale): GuideCopy {
  return guide.copy[locale]
}

export const GUIDES: Guide[] = [
  {
    slug: 'what-fits-in-a-10x10',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: { size: 'medium' },
    copy: {
      en: {
        title: 'What fits in a 10x10 storage unit?',
        description:
          'A 10x10 holds about a one-bedroom apartment — sofa, mattress set, appliances and boxes, with room to walk in. Here is what that means in practice.',
        ctaLabel: 'See medium units near you',
        faqs: [
          {
            question: 'Is a 10x10 big enough for a two-bedroom home?',
            answer:
              'Usually not, if you mean everything in it. A 10x10 takes a one-bedroom comfortably and a small two-bedroom if you are willing to stack and leave the larger furniture behind. For a full two-bedroom, a 10x15 is the size that stops being a puzzle.',
          },
          {
            question: 'Can I get a car into a 10x10?',
            answer:
              'No. A 10x10 is ten feet deep and almost every car is longer than that. A 10x20 is the smallest size that takes a car, and it leaves room to walk around it.',
          },
          {
            question: 'How tall is a 10x10 unit?',
            answer:
              'Usually eight feet, which is why the floor area understates what a unit holds — stacking to shoulder height roughly doubles what you fit. The ceiling height for each size is listed on the facility page where it differs.',
          },
        ],
      },
      es: {
        title: '¿Qué cabe en una unidad de 10x10?',
        description:
          'Una de 10x10 guarda más o menos lo de un departamento de una recámara — sofá, cama, electrodomésticos y cajas, y todavía puede entrar caminando. Esto es lo que quiere decir en la práctica.',
        ctaLabel: 'Ver unidades medianas cerca de usted',
        faqs: [
          {
            question: '¿Una de 10x10 alcanza para una casa de dos recámaras?',
            answer:
              'Por lo general no, si se refiere a todo lo que hay en ella. Una de 10x10 lleva bien lo de una recámara, y lo de dos recámaras chicas si usted está dispuesto a apilar y dejar fuera los muebles más grandes. Para dos recámaras completas, la de 10x15 es el tamaño que deja de ser un rompecabezas.',
          },
          {
            question: '¿Cabe un carro en una de 10x10?',
            answer:
              'No. Una de 10x10 tiene diez pies de fondo y casi todos los carros son más largos que eso. La de 10x20 es el tamaño más chico donde cabe un carro, y todavía deja lugar para caminar alrededor.',
          },
          {
            question: '¿Qué altura tiene una unidad de 10x10?',
            answer:
              'Casi siempre ocho pies, y por eso los pies cuadrados del piso dicen menos de lo que de verdad cabe — apilar hasta la altura del hombro más o menos duplica lo que le entra. La altura del techo de cada tamaño viene en la página de la sucursal donde sea distinta.',
          },
        ],
      },
    },
  },
  {
    slug: 'moving-checklist',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: { size: 'large' },
    copy: {
      en: {
        title: 'A moving checklist that starts four weeks out',
        description:
          'What to do four weeks, one week and one day before a move, in the order that stops you paying for a second van. Written for a move that involves storage.',
        ctaLabel: 'Find a unit for moving day',
        faqs: [],
      },
      es: {
        title: 'Una lista para la mudanza que empieza cuatro semanas antes',
        description:
          'Qué hacer cuatro semanas, una semana y un día antes de la mudanza, en el orden que evita que pague un segundo camión. Escrita para una mudanza que incluye una bodega.',
        ctaLabel: 'Busque una unidad para el día de la mudanza',
        faqs: [],
      },
    },
  },
  {
    slug: 'packing-tips',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: {},
    copy: {
      en: {
        title: 'How to pack a storage unit so you can get to things',
        description:
          'Heavy low, light high, a walkway down the middle, and labels facing out. The handful of decisions that separate a unit you can use from a wall of boxes.',
        ctaLabel: 'Find storage near you',
        faqs: [],
      },
      es: {
        title: 'Cómo acomodar una unidad para que pueda llegar a sus cosas',
        description:
          'Lo pesado abajo, lo ligero arriba, un pasillo en medio y las etiquetas hacia afuera. Las pocas decisiones que separan una unidad que sí puede usar de una pared de cajas.',
        ctaLabel: 'Busque bodegas cerca de usted',
        faqs: [],
      },
    },
  },
  {
    slug: 'climate-control',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: { feature: 'climate' },
    copy: {
      en: {
        title: 'Do you need a climate-controlled unit?',
        description:
          'Climate control costs more every month. What it actually protects, what it does not, and how to tell which of your things care.',
        ctaLabel: 'See climate-controlled units near you',
        faqs: [
          {
            question: 'Is climate control the same as air conditioning?',
            answer:
              'Not quite. A climate-controlled unit is held inside a temperature range and, at most facilities, a humidity range — it is not cooled to a comfortable working temperature. It will be warmer than your house in August and colder in January, just never at the extremes that damage things.',
          },
          {
            question: 'Does climate control stop mould?',
            answer:
              'It removes the main cause, which is humidity swinging up and condensing on cold surfaces. It cannot help anything that goes in damp. Anything stored wet — a mattress, a rug, a coat — will grow mould in any unit, and the fix is drying it before it goes in, not paying more for the space.',
          },
          {
            question: 'What actually needs climate control?',
            answer:
              'Wood furniture, anything upholstered, electronics, photographs, documents, vinyl records, musical instruments, and anything with glue in it. Garden tools, car parts, plastic bins of clothing and most household clutter do not.',
          },
        ],
      },
      es: {
        title: '¿Necesita una unidad con clima controlado?',
        description:
          'El clima controlado cuesta más cada mes. Qué protege de verdad, qué no protege, y cómo saber a cuáles de sus cosas les importa.',
        ctaLabel: 'Ver unidades con clima controlado cerca de usted',
        faqs: [
          {
            question: '¿El clima controlado es lo mismo que el aire acondicionado?',
            answer:
              'No exactamente. Una unidad con clima controlado se mantiene dentro de un rango de temperatura y, en casi todas las sucursales, dentro de un rango de humedad — no se enfría a una temperatura agradable para estar ahí. Estará más caliente que su casa en agosto y más fría en enero, nada más nunca llega a los extremos que dañan las cosas.',
          },
          {
            question: '¿El clima controlado evita el moho?',
            answer:
              'Quita la causa principal, que es la humedad que sube y se condensa en las superficies frías. No puede hacer nada por algo que entra mojado. Cualquier cosa guardada húmeda — un colchón, un tapete, un abrigo — va a criar moho en cualquier unidad, y la solución es secarla antes de meterla, no pagar más por el espacio.',
          },
          {
            question: '¿Qué necesita de verdad clima controlado?',
            answer:
              'Los muebles de madera, todo lo tapizado, los aparatos electrónicos, las fotografías, los documentos, los discos de vinilo, los instrumentos musicales y cualquier cosa que lleve pegamento. Las herramientas de jardín, las refacciones de carro, las cajas de plástico con ropa y la mayoría de los tiliches de la casa, no.',
          },
        ],
      },
    },
  },
]

const BY_SLUG = new Map(GUIDES.map((guide) => [guide.slug, guide]))

export function guideBySlug(slug: string): Guide | null {
  return BY_SLUG.get(slug) ?? null
}

export function guidePath(guide: { slug: string }): string {
  return `/guides/${guide.slug}`
}

/// AC3: the CTA link, built from the typed filter.
///
/// It points at the SEARCH, not at a facility, because "nearest facility"
/// requires a location nobody has given us on a guide page — the same reason
/// the city page prints no distance (D-59). The search carries the filter
/// through to whichever facility the reader picks, so the facility page opens
/// already filtered to the size or feature the guide recommended.
export function guideCtaHref(filter: GuideFilter): string {
  const params = new URLSearchParams()
  if (filter.size) params.set('size', filter.size)
  if (filter.feature) params.set('features', filter.feature)
  const query = params.toString()
  return query ? `/storage/search?${query}` : '/storage/search'
}

/// What the CTA is promising, in words, for the sentence beside the button.
///
/// Read from the same catalogues the filters themselves use, so the guide says
/// "Medium (5×10 to 10×10)" exactly as the facility page's filter control does
/// — a reader who follows this link should recognise where they landed.
///
/// B-090 part 6 resolved this against the English dictionary deliberately,
/// because the guides were English prose and a Spanish filter name in the
/// middle of an English sentence is worse than an English one. B-262 translated
/// the guides, so it takes a locale — which is what that note said would happen
/// and the reason it was written down rather than left as a constant.
export function guideFilterLabel(filter: GuideFilter, locale: Locale): string | null {
  const dict = dictionaryFor(locale)
  if (filter.size) return dict[SIZE_BANDS[filter.size].labelKey]
  if (filter.feature) return dict[FEATURE_FILTERS[filter.feature].labelKey]
  return null
}

export type HubEntry = {
  title: string
  description: string
  href: string
  /// True for the size guide, which is not an MDX guide and does not live
  /// under /guides — see the note in the hub page.
  external: boolean
}

/// PRD 04 US-4 AC2's launch set: five guides.
///
/// The size guide is the fifth and it is NOT re-published here. It has lived at
/// `/storage/size-guide` since B-016, is in the sitemap, and is linked from the
/// facility page, the search page and every city page. Copying its text under
/// `/guides/` to make the set look uniform would manufacture exactly the
/// duplicate content this row's part 6 exists to warn about — so the hub links
/// to where it already is. See D-60.
///
/// B-262: its card is translated even though the page it points at is not yet
/// — the size guide's own comparison table is still English prose. A Spanish
/// card that lands on an English page is a worse experience than an English
/// card; it is also the honest one, because the card is the hub's own words and
/// the page behind it is the size guide's.
const SIZE_GUIDE_COPY: Record<Locale, { title: string; description: string }> = {
  en: {
    title: 'What size storage unit do I need?',
    description:
      'Every size we rent, with a real-world comparison for each — from a large closet to a two-car garage.',
  },
  es: {
    title: '¿Qué tamaño de unidad necesito?',
    description:
      'Todos los tamaños que rentamos, con una comparación de la vida real para cada uno — desde un clóset grande hasta un garaje para dos carros.',
  },
}

export function sizeGuideEntry(locale: Locale): HubEntry {
  return { ...SIZE_GUIDE_COPY[locale], href: '/storage/size-guide', external: true }
}

export function hubEntries(locale: Locale): HubEntry[] {
  return [
    sizeGuideEntry(locale),
    ...GUIDES.map((guide) => {
      const copy = guideCopy(guide, locale)
      return {
        title: copy.title,
        description: copy.description,
        href: guidePath(guide),
        external: false,
      }
    }),
  ]
}
