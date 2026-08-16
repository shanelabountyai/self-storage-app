import QRCode from 'qrcode-svg'

// B-108 / PRD 00 §7.1. The enrolment QR.
//
// ── Why this is generated here and inlined ──────────────────────────────────
//
// The QR ENCODES THE SHARED SECRET. That single fact decides the whole shape:
//
//   * it is never a fetchable URL — an endpoint that renders a QR for a pending
//     enrolment is an endpoint that hands out somebody's TOTP seed to whoever
//     can guess the enrolment id, and it would sit in access logs and CDN
//     caches besides;
//   * it is never logged, so nothing here writes the URI or the SVG anywhere;
//   * it dies with the pending enrolment, which it does by construction — it is
//     computed during the render of the page that already holds the secret and
//     is never stored.
//
// Inline SVG rather than a `data:` URI image, so it inherits the page's own CSP
// without needing `img-src data:` opened up.

export type EnrolmentQr = {
  /// SVG markup, safe to inline. Contains only path data — the URI itself is
  /// not present as text, which is checked in the tests.
  svg: string
}

/// Renders the `otpauth://` URI as a QR.
///
/// `ecl: 'M'` — medium error correction, the level every authenticator app
/// documents its own QRs at. Higher correction makes the code denser for no
/// benefit here: this is read from a laptop screen at arm's length, not off a
/// crumpled label.
export function enrolmentQr(otpauthUri: string): EnrolmentQr {
  const svg = new QRCode({
    content: otpauthUri,
    padding: 1,
    width: 200,
    height: 200,
    color: '#000000',
    background: '#ffffff',
    ecl: 'M',
    // One path for the whole code rather than a rect per module: ~30KB of
    // markup becomes a few KB, and this is inlined into the document.
    join: true,
    container: 'svg-viewbox',
  }).svg()

  return { svg }
}
