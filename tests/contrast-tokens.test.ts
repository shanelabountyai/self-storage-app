import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// B-093 / WCAG 1.4.11 Non-text Contrast.
//
// axe checks *text* contrast only — it has no opinion about the boundary of a
// control or the visibility of a focus ring, which is why the shipped site
// passed every automated scan with a 1.54:1 focus indicator and 1.26:1 input
// borders. This test is the guard those scans cannot provide: it reads the real
// token values out of globals.css and does the arithmetic.

const css = readFileSync(
  fileURLToPath(new URL('../apps/web/app/globals.css', import.meta.url)),
  'utf8',
)

/// Pulls a token out of a given `:root` / `.dark` block. Scoped to the block so
/// the light and dark themes can't be confused for one another.
function token(block: ':root' | '.dark', name: string): string {
  const blockBody = new RegExp(`\\${block}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)
  if (!blockBody) throw new Error(`no ${block} block in globals.css`)
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(blockBody[1])
  if (!match) throw new Error(`no --${name} in ${block}`)
  return match[1].trim()
}

/// Relative luminance (WCAG 2.x definition) of an `oklch(L C H)` value.
///
/// B-363: the design system's neutrals are warm (non-zero chroma), so the old
/// achromatic shortcut (Y = L³) no longer applies. This is the full
/// oklch → oklab → LMS → linear-sRGB chain (Björn Ottosson's matrices), gamut
/// clipped, then the WCAG luminance weights. For chroma 0 it still reduces to
/// L³, which the pinned values below check.
function luminanceOfOklch(value: string): number {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value)
  if (!match) throw new Error(`not an opaque oklch value: ${value}`)
  const [L, C, H] = match.slice(1).map(Number)
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (v: number) => Math.min(1, Math.max(0, v))
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminanceOfOklch(a), luminanceOfOklch(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the luminance shortcut itself', () => {
  it('reproduces contrast ratios measured independently', () => {
    // The accessibility audit measured the pre-B-093 tokens against white with
    // a different tool and got 2.59:1 for the old ring and 1.26:1 for the old
    // shared border. If this model is right it must land on the same numbers.
    expect(contrast('oklch(0.708 0 0)', 'oklch(1 0 0)')).toBeCloseTo(2.59, 2)
    expect(contrast('oklch(0.922 0 0)', 'oklch(1 0 0)')).toBeCloseTo(1.26, 2)
    // Black on white is the fixed point of the whole scale.
    expect(contrast('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 5)
  })

  it('handles chroma: pure sRGB red on white is 4.00:1', () => {
    // #ff0000 is oklch(0.628 0.2577 29.23); its WCAG contrast on white is a
    // well-known 4.00:1. Loose tolerance for the rounded oklch coordinates.
    expect(contrast('oklch(0.628 0.2577 29.23)', 'oklch(1 0 0)')).toBeCloseTo(4.0, 1)
  })

  it('puts the 3:1 floor where the arithmetic says it is', () => {
    // 1.05/(L³+0.05) = 3  ⇒  L = ∛0.30 = 0.6694. Anything lighter fails 1.4.11.
    expect(contrast('oklch(0.6694 0 0)', 'oklch(1 0 0)')).toBeCloseTo(3.0, 2)
  })
})

describe('1.4.11 — operable controls and focus indicators', () => {
  const light = {
    background: token(':root', 'background'),
    card: token(':root', 'card'),
    ring: token(':root', 'ring'),
    input: token(':root', 'input'),
  }

  it('the focus ring clears 3:1 against the page and against cards', () => {
    // The skip link is the case that matters most: it exists solely for
    // keyboard users, and it sits on --background.
    expect(contrast(light.ring, light.background)).toBeGreaterThanOrEqual(3)
    expect(contrast(light.ring, light.card)).toBeGreaterThanOrEqual(3)
  })

  it('operable control borders clear 3:1', () => {
    // --input is the boundary of anything the user operates: text inputs,
    // selects, outline buttons, the map disclosure. --border stays decorative
    // and is deliberately NOT asserted — dividers and card edges are exempt.
    expect(contrast(light.input, light.background)).toBeGreaterThanOrEqual(3)
  })

  it('holds in the dark theme too', () => {
    // No .dark toggle ships yet, so this is guarding a token that nothing reads
    // — which is exactly when a wrong value survives unnoticed until the day
    // someone adds the switch.
    const dark = {
      background: token('.dark', 'background'),
      ring: token('.dark', 'ring'),
      input: token('.dark', 'input'),
    }
    expect(contrast(dark.ring, dark.background)).toBeGreaterThanOrEqual(3)
    expect(contrast(dark.input, dark.background)).toBeGreaterThanOrEqual(3)
  })
})

describe('the focus indicator is declared, not inherited', () => {
  it('sets an explicit :focus-visible outline', () => {
    // Recolouring the UA's `outline-style: auto` ring is honoured by Chromium
    // and Firefox and largely ignored by Safari, so relying on it left focus
    // visibility undefined per browser rather than merely weak.
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/)
  })

  it('never applies the ring at partial alpha', () => {
    // `outline-ring/50` composited a 2.59:1 ring down to 1.54:1. The alpha, not
    // the token, was the bug — so the token being right is not enough.
    //
    // Asserted against declarations only, not comments: the comment in
    // globals.css explaining this very bug names the old class, and a test that
    // failed on its own explanation would just get the explanation deleted.
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).not.toMatch(/outline-ring\/\d+/)
  })
})

// B-251 / SC 1.4.11. A "you are here" state has to be perceivable, and the two
// signals this app reached for by default — a `bg-accent` tint and a
// `font-medium` bump — are not. `--accent` is 1.09:1 against the light
// background and 1.31:1 against the dark one; a 500-vs-400 weight difference at
// 14px is not a state a reader with reduced contrast sensitivity picks out of
// twelve chips. 1.4.1 Use of Colour was met the whole time (weight is a
// non-colour signal) and `aria-current` told assistive technology correctly, so
// this was a sighted low-vision problem specifically — which is why no scan and
// no screen-reader check would ever have surfaced it.
describe('1.4.11 — the selected-state indicator', () => {
  it('cannot be carried by --accent, in either theme', () => {
    // Pinned as a FAILING pair on purpose. This is the arithmetic that made
    // B-251 a defect; if `--accent` is ever darkened enough to clear 3:1 on its
    // own, this test failing is the prompt to revisit the borders below rather
    // than a problem in itself.
    expect(contrast(token(':root', 'accent'), token(':root', 'background'))).toBeLessThan(3)
    expect(contrast(token('.dark', 'accent'), token('.dark', 'background'))).toBeLessThan(3)
  })

  it('uses --foreground, which clears 3:1 with room in both themes', () => {
    // `--input` would clear the floor too (3.64:1 / 3.30:1) and the row offered
    // it. It is not used, because the UNSELECTED chip is already `border-input`
    // — reusing it would leave border THICKNESS as the only difference between
    // the two states, which is the same "technically a signal" trap as the
    // font-weight bump this row is fixing.
    expect(contrast(token(':root', 'foreground'), token(':root', 'background'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token('.dark', 'foreground'), token('.dark', 'background'))).toBeGreaterThanOrEqual(3)
  })
})

// B-363 / SC 1.4.3. The design system's own tokens fail AA in three places
// (D-147): white on clay-500, ink-3 as secondary text, and — covered above —
// the field border and focus ring. These pin the substitutions.
describe('1.4.3 — text on the design-system palette', () => {
  const t = (name: string) => token(':root', name)

  it('button text clears 4.5:1 on the primary fill', () => {
    expect(contrast(t('primary-foreground'), t('primary'))).toBeGreaterThanOrEqual(4.5)
  })

  it('secondary text clears 4.5:1 on the page, the well and the accent tint', () => {
    for (const ground of ['background', 'card', 'muted', 'accent']) {
      expect(contrast(t('muted-foreground'), t(ground))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('primary-coloured text and the destructive colour clear 4.5:1 on the page', () => {
    expect(contrast(t('primary'), t('background'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t('destructive'), t('background'))).toBeGreaterThanOrEqual(4.5)
  })
})

// B-364. The public shell's dark bands (utility strip, footer).
describe('the inverse surface', () => {
  const t = (name: string) => token(':root', name)

  it('carries text at 4.5:1, secondary text included', () => {
    expect(contrast(t('inverse-foreground'), t('inverse'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t('inverse-muted'), t('inverse'))).toBeGreaterThanOrEqual(4.5)
  })

  it('needs its own focus ring: the page ring is too close to 3:1 on it', () => {
    expect(contrast(t('inverse-ring'), t('inverse'))).toBeGreaterThanOrEqual(3)
    expect(css).toMatch(/\[data-surface='inverse'\]\s*\{\s*--ring:\s*var\(--inverse-ring\)/)
  })

  // B-371. The `inverse` Button variant: rest sits on --inverse, hover and
  // aria-expanded on --inverse-raised, all with --inverse-foreground text; the
  // border is a control boundary (3:1) and the focus ring stays --inverse-ring.
  it('the inverse button variant holds 4.5:1 text and 3:1 non-text in every state', () => {
    for (const bg of ['inverse', 'inverse-raised']) {
      expect(contrast(t('inverse-foreground'), t(bg))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t('inverse-ring'), t(bg))).toBeGreaterThanOrEqual(3)
    }
    expect(contrast(t('inverse-muted'), t('inverse'))).toBeGreaterThanOrEqual(3)
    const variant = /inverse:\s*"([^"]+)"/.exec(
      readFileSync(fileURLToPath(new URL('../apps/web/components/ui/button.tsx', import.meta.url)), 'utf8'),
    )![1]
    expect(variant).not.toMatch(/(^|\s)(hover:|aria-expanded:)?text-(foreground|muted-foreground)\b/)
  })
})
