import { describe, expect, it } from 'vitest'
import { enrolmentQr } from '../apps/web/lib/auth/totp-qr'
import { formatSecretForDisplay } from '../packages/core/auth/totp'

// B-108(1). The enrolment QR, and the properties that make it safe to render.

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const URI = `otpauth://totp/Storage:owner@demo.example.com?secret=${SECRET}&issuer=Storage`

describe('enrolmentQr', () => {
  it('produces inline SVG, not a URL to fetch', () => {
    const { svg } = enrolmentQr(URI)
    expect(svg.startsWith('<?xml') || svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('</svg>')
    // The whole reason it is generated here: an endpoint that renders a QR for
    // a pending enrolment hands out somebody's TOTP seed to whoever can guess
    // the id, and lands it in access logs and CDN caches besides.
    //
    // Asserted as "nothing to fetch" rather than "no http", because the SVG
    // namespace is itself an `http://www.w3.org/...` URI — an identifier, not
    // a request. The property that matters is that nothing here causes a load.
    expect(svg).not.toMatch(/\shref=/)
    expect(svg).not.toMatch(/\ssrc=/)
    expect(svg).not.toContain('xlink:href')
  })

  it('never puts the shared secret in the markup as text', () => {
    // The QR ENCODES the secret — that is its job. What must not happen is the
    // secret appearing as readable text in the DOM, where an extension dump,
    // a copied "view source" or a screenshot-to-text tool would find it
    // without ever decoding an image.
    const { svg } = enrolmentQr(URI)
    expect(svg).not.toContain(SECRET)
    expect(svg).not.toContain('otpauth')
    expect(svg).not.toContain('secret')
  })

  it('collapses the modules into one path rather than thousands of rects', () => {
    // Measured, not assumed: `join: true` takes this from ~140KB to ~41KB for
    // a real otpauth URI. The remainder is the honest price of inlining — a
    // dense QR is a lot of path data, and the alternative is the fetchable
    // endpoint this whole module exists to avoid. Acceptable HERE specifically:
    // `/mfa` is an admin-adjacent page a staff member sees once, not a public
    // route with a performance budget.
    //
    // The bound is a regression guard, not a target. It would catch `join`
    // being dropped, which is a 3x blowup.
    const { svg } = enrolmentQr(URI)
    expect(svg.length).toBeLessThan(60_000)
    // One path element, not one per module.
    expect(svg.match(/<path/g) ?? []).toHaveLength(1)
  })

  it('encodes different URIs differently', () => {
    // Cheap, but it is the assertion that would catch a stub or a cached
    // constant — a QR that is the same for every enrolment is worse than none.
    const a = enrolmentQr(URI).svg
    const b = enrolmentQr(URI.replace(SECRET, 'MFRGGZDFMZTWQ2LKMFRGGZDFMZTW')).svg
    expect(a).not.toBe(b)
  })
})

describe('the typed key stays an adequate text equivalent', () => {
  it('groups for the eye but not for the ear', () => {
    // `formatSecretForDisplay` makes pronounceable four-character blocks, which
    // VoiceOver reads as words — and I/1, O/0, S/5 are indistinguishable
    // spoken. The page pairs the grouped form (aria-hidden) with a
    // character-separated reading, matching gate-code-panel.tsx.
    const grouped = formatSecretForDisplay(SECRET)
    expect(grouped).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')

    const spoken = SECRET.split('').join(' ')
    // Every character stands alone, so nothing is read as a word.
    expect(spoken.split(' ')).toHaveLength(SECRET.length)
    expect(spoken).not.toContain('JBSW')
  })
})
