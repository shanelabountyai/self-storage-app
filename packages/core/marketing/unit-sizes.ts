// PRD 04 §7 Phase 3 / PRD 00 §6 (B-089). What a unit size IS, in one place.
//
// This catalogue was written for `/storage/size-guide` (B-017) and lived inside
// that page's file. It moved here when the per-city/size landing pages needed
// the same facts: a "10×10 storage units in Austin" page whose only distinct
// content is the number 10 is thin content by construction, and what makes it
// genuinely different from the 10×15 page next to it is exactly what is stored
// here — the comparison, what fits, and who rents it.
//
// **D-60 is not weakened by this and the distinction matters.** That decision
// says the size guide is LINKED rather than re-published, because copying the
// whole guide onto another page manufactures the duplicate content B-082 part 6
// exists to detect. A landing page takes two sentences that are unique to its
// own size and links to the guide for the rest; it does not reproduce the seven
// entries, the `fits` lists or the comparisons of sizes it is not about.

/// B-262. The words about a size, in one language.
///
/// Split from the measurements for the same reason `GuideCopy` was: the
/// measurement is a fact and the sentence about it is prose. A `Record<
/// MarketingLocale, …>` makes a half-translated size a typecheck failure rather
/// than a Spanish landing page with an English comparison in the middle of it —
/// and these two sentences are the ONLY thing that makes sibling size pages
/// differ enough to clear D-77's duplicate gate, so a fallback to English here
/// would quietly hand every Spanish size page the same intro.
import { DEFAULT_MARKETING_LOCALE, type MarketingLocale } from './locale.ts'

export type UnitSizeCopy = {
  /// One sentence a reader can picture. Unique per size, which is what makes a
  /// per-size page worth publishing.
  comparison: string
  fits: string[]
  typical: string
}

export type UnitSizeFacts = {
  /// "10 × 10", with the spacing the guide prints. Not the URL form.
  label: string
  sqFt: number
  comparison: string
  fits: string[]
  typical: string
}

type UnitSize = {
  label: string
  sqFt: number
  copy: Record<MarketingLocale, UnitSizeCopy>
}

/// Keyed by `dimensionKey` so a facility's width and length find their entry
/// without a linear scan at every call site.
export const UNIT_SIZES: Record<string, UnitSize> = {
  '5x5': {
    label: '5 × 5',
    sqFt: 25,
    copy: {
      en: {
        comparison: 'A large closet.',
        fits: [
          'Boxes and files',
          'Seasonal decorations',
          'A bike',
          'A few small pieces of furniture',
        ],
        typical: 'Students between terms, or clearing one room.',
      },
      es: {
        comparison: 'Un clóset grande.',
        fits: ['Cajas y archivos', 'Adornos de temporada', 'Una bicicleta', 'Unos cuantos muebles pequeños'],
        typical: 'Estudiantes entre ciclos, o vaciar un cuarto.',
      },
    },
  },
  '5x10': {
    label: '5 × 10',
    sqFt: 50,
    copy: {
      en: {
        comparison: 'A walk-in wardrobe, or half a single garage.',
        fits: ['A mattress set', 'A chest of drawers', 'Boxes', 'A small sofa'],
        typical: 'A studio flat, or one bedroom of furniture.',
      },
      es: {
        comparison: 'Un vestidor, o medio garaje sencillo.',
        fits: ['Un colchón con su base', 'Una cómoda', 'Cajas', 'Un sofá chico'],
        typical: 'Un departamento de un ambiente, o los muebles de una recámara.',
      },
    },
  },
  '5x15': {
    label: '5 × 15',
    sqFt: 75,
    copy: {
      en: {
        comparison: 'A large walk-in wardrobe.',
        fits: ['The contents of a large bedroom', 'A sofa and armchair', 'Twenty or so boxes'],
        typical: 'A one-bedroom flat without appliances.',
      },
      es: {
        comparison: 'Un vestidor grande.',
        fits: ['Lo que hay en una recámara grande', 'Un sofá y un sillón', 'Unas veinte cajas'],
        typical: 'Un departamento de una recámara sin electrodomésticos.',
      },
    },
  },
  '10x10': {
    label: '10 × 10',
    sqFt: 100,
    copy: {
      en: {
        comparison: 'About half a standard garage.',
        fits: [
          'A full one-bedroom apartment',
          'A sofa, mattress set and dining set',
          'A washer and dryer',
        ],
        typical: 'The most-rented size. A one-bedroom home, or a serious declutter.',
      },
      es: {
        comparison: 'Como la mitad de un garaje normal.',
        fits: [
          'Un departamento completo de una recámara',
          'Un sofá, una cama con su base y un comedor',
          'Una lavadora y una secadora',
        ],
        typical: 'El tamaño que más se renta. Una casa de una recámara, o una limpia a fondo.',
      },
    },
  },
  '10x15': {
    label: '10 × 15',
    sqFt: 150,
    copy: {
      en: {
        comparison: 'A large single garage.',
        fits: ['A two-bedroom home', 'Major appliances', 'Boxed contents of a loft'],
        typical: 'Moving out of a two-bedroom home.',
      },
      es: {
        comparison: 'Un garaje sencillo grande.',
        fits: ['Una casa de dos recámaras', 'Electrodomésticos grandes', 'Lo del tapanco, en cajas'],
        typical: 'Mudarse de una casa de dos recámaras.',
      },
    },
  },
  '10x20': {
    label: '10 × 20',
    sqFt: 200,
    copy: {
      en: {
        comparison: 'A standard single garage.',
        fits: [
          'A three-bedroom house',
          'A car, with room around it',
          'Appliances and garden equipment',
        ],
        typical: 'A whole-house move, or storing a vehicle.',
      },
      es: {
        comparison: 'Un garaje sencillo normal.',
        fits: [
          'Una casa de tres recámaras',
          'Un carro, con lugar alrededor',
          'Electrodomésticos y herramienta de jardín',
        ],
        typical: 'Mudar una casa entera, o guardar un vehículo.',
      },
    },
  },
  '10x30': {
    label: '10 × 30',
    sqFt: 300,
    copy: {
      en: {
        comparison: 'A two-car garage.',
        fits: [
          'A four- or five-bedroom house',
          'Commercial stock or equipment',
          'A vehicle plus contents',
        ],
        typical: 'Large family moves, and small businesses.',
      },
      es: {
        comparison: 'Un garaje para dos carros.',
        fits: [
          'Una casa de cuatro o cinco recámaras',
          'Mercancía o equipo de un negocio',
          'Un vehículo y además sus cosas',
        ],
        typical: 'Mudanzas de familias grandes, y negocios chicos.',
      },
    },
  },
}

/// The guide's reading order — smallest first. Derived from the catalogue so a
/// size cannot be in the guide and absent from the pages, or the reverse.
export const UNIT_SIZE_ORDER: readonly string[] = Object.keys(UNIT_SIZES).sort(
  (a, b) => UNIT_SIZES[a]!.sqFt - UNIT_SIZES[b]!.sqFt,
)

/// The URL and lookup form of a unit's dimensions: `10x10`.
///
/// Lower-case `x` and no spaces or units — one canonical spelling, because this
/// string is a URL segment, a map key and a page heading's source, and three
/// spellings would be three pages for one size.
export function dimensionKey(widthFt: number, lengthFt: number): string {
  return `${widthFt}x${lengthFt}`
}

/// Parses a URL segment back into dimensions, or null when it is not one.
///
/// Strict on purpose: this is untrusted input naming a page, and anything it
/// accepts becomes a URL that exists. `10x10` only — not `10X10`, not `10 x 10`,
/// not `010x10`, each of which would be a second URL for one page. The caller
/// redirects the recoverable spellings to the canonical one rather than
/// rendering them.
export function parseDimension(segment: string): { widthFt: number; lengthFt: number } | null {
  const match = /^([1-9]\d{0,2})x([1-9]\d{0,2})$/.exec(segment)
  if (!match) return null
  return { widthFt: Number(match[1]), lengthFt: Number(match[2]) }
}

/// The canonical spelling of a segment somebody typed, or null when it cannot
/// be salvaged. `10X10`, `10 x 10` and `10×10` are all the same page as `10x10`
/// and are redirected to it rather than 404ed or duplicated.
export function canonicalDimension(segment: string): string | null {
  const cleaned = segment.toLowerCase().replace(/\s+/g, '').replace(/[×✕]/g, 'x')
  const parsed = parseDimension(cleaned)
  return parsed ? dimensionKey(parsed.widthFt, parsed.lengthFt) : null
}

/// "10 × 10" for display, from dimensions rather than from the catalogue — a
/// size nobody wrote a guide entry for still has to render its own heading.
export function dimensionLabel(widthFt: number, lengthFt: number): string {
  return `${widthFt} × ${lengthFt}`
}

/// "10 foot by 10 foot" — what a screen reader should say.
///
/// `×` is a multiplication sign and is announced as "times", with the unit
/// missing entirely: "10 times 10" is not a size. The size guide and the
/// facility page both already render the compact form `aria-hidden` beside a
/// visually-hidden sentence, and B-089's pages do the same rather than
/// inventing a third treatment — hence one function instead of the guide's
/// inline `label.replace(' × ', ' foot by ')`.
export function dimensionSpoken(widthFt: number, lengthFt: number): string {
  return `${widthFt} foot by ${lengthFt} foot`
}

/// The guide entry for a size, or null when there is none.
///
/// Null is a real and expected answer: an operator can create a 8×12 unit type
/// and the guide has seven standard sizes. The page renders without the
/// comparison sentences rather than inventing them — and is then likelier to
/// trip the duplicate gate, which is the honest outcome.
export function sizeFacts(
  widthFt: number,
  lengthFt: number,
  locale: MarketingLocale = DEFAULT_MARKETING_LOCALE,
): UnitSizeFacts | null {
  const size = UNIT_SIZES[dimensionKey(widthFt, lengthFt)]
  if (!size) return null
  return { label: size.label, sqFt: size.sqFt, ...size.copy[locale] }
}
