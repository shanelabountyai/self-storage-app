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

/// Relative luminance (WCAG 2.x definition) of an achromatic `oklch(L 0 0)`.
///
/// For chroma 0 the oklab→LMS→linear-sRGB chain collapses: a = b = 0 makes all
/// three cone responses equal L, each is cubed, and the three linear-sRGB rows
/// each sum to 1. So linear R = G = B = L³, and since the luminance
/// coefficients also sum to 1, Y = L³ exactly. No matrix needed — but the test
/// below pins this against known values so the shortcut can't rot.
function luminanceOfOklch(value: string): number {
  const match = /^oklch\(\s*([\d.]+)\s+0\s+0\s*\)$/.exec(value)
  if (!match) throw new Error(`not an achromatic oklch value: ${value}`)
  return Number(match[1]) ** 3
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
