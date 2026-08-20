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

export type UnitSizeFacts = {
  /// "10 × 10", with the spacing the guide prints. Not the URL form.
  label: string
  sqFt: number
  /// One sentence a reader can picture. Unique per size, which is what makes a
  /// per-size page worth publishing.
  comparison: string
  fits: string[]
  typical: string
}

/// Keyed by `dimensionKey` so a facility's width and length find their entry
/// without a linear scan at every call site.
export const UNIT_SIZES: Record<string, UnitSizeFacts> = {
  '5x5': {
    label: '5 × 5',
    sqFt: 25,
    comparison: 'A large closet.',
    fits: ['Boxes and files', 'Seasonal decorations', 'A bike', 'A few small pieces of furniture'],
    typical: 'Students between terms, or clearing one room.',
  },
  '5x10': {
    label: '5 × 10',
    sqFt: 50,
    comparison: 'A walk-in wardrobe, or half a single garage.',
    fits: ['A mattress set', 'A chest of drawers', 'Boxes', 'A small sofa'],
    typical: 'A studio flat, or one bedroom of furniture.',
  },
  '5x15': {
    label: '5 × 15',
    sqFt: 75,
    comparison: 'A large walk-in wardrobe.',
    fits: ['The contents of a large bedroom', 'A sofa and armchair', 'Twenty or so boxes'],
    typical: 'A one-bedroom flat without appliances.',
  },
  '10x10': {
    label: '10 × 10',
    sqFt: 100,
    comparison: 'About half a standard garage.',
    fits: ['A full one-bedroom apartment', 'A sofa, mattress set and dining set', 'A washer and dryer'],
    typical: 'The most-rented size. A one-bedroom home, or a serious declutter.',
  },
  '10x15': {
    label: '10 × 15',
    sqFt: 150,
    comparison: 'A large single garage.',
    fits: ['A two-bedroom home', 'Major appliances', 'Boxed contents of a loft'],
    typical: 'Moving out of a two-bedroom home.',
  },
  '10x20': {
    label: '10 × 20',
    sqFt: 200,
    comparison: 'A standard single garage.',
    fits: ['A three-bedroom house', 'A car, with room around it', 'Appliances and garden equipment'],
    typical: 'A whole-house move, or storing a vehicle.',
  },
  '10x30': {
    label: '10 × 30',
    sqFt: 300,
    comparison: 'A two-car garage.',
    fits: ['A four- or five-bedroom house', 'Commercial stock or equipment', 'A vehicle plus contents'],
    typical: 'Large family moves, and small businesses.',
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
export function sizeFacts(widthFt: number, lengthFt: number): UnitSizeFacts | null {
  return UNIT_SIZES[dimensionKey(widthFt, lengthFt)] ?? null
}
