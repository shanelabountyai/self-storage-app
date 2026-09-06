import type { Locale } from '@/lib/i18n'

// B-259 (D-125). The words a renter agreed to, and the version that names
// them — one per language, in one place.
//
// ── Why this is a file and not four dictionary entries ───────────────────────
//
// B-090f translated the move-in path and deliberately left these four strings
// in English, because a consent disclosure is not interface copy. Each one is
// recorded on a `Consent` row with a version constant, and that version is the
// evidence of WHAT WORDS the renter was shown: TCPA wants express written
// consent to marketing texts specifically, and E-SIGN wants consent to
// transact electronically as its own affirmative act. Putting the Spanish in
// `es.ts` would have translated the words while leaving the version saying
// `v1` — recording an English version number against Spanish text, which
// asserts a consent nobody gave. That is the change that looks like a one-line
// fix and cannot be undone after the fact.
//
// So the text and the version travel together, per locale, in one object.
// There is no way to add a translation here without giving it a version, and
// no way to change the words of one language without noticing that the other
// exists — which is the whole reason for the shape.
//
// ── The Spanish is DRAFT, on exactly the same footing as the English ─────────
//
// D-10 already says the legal copy in this repo is draft pending attorney
// review, and `MARKETING_SMS_DISCLOSURE`'s own version has said `v1-draft`
// since B-123. The Spanish inherits that and no more: it is not held to a
// lower standard than the English, and it is not held to a higher one either.
// A reviewer reading both sees two versions to sign off, not one blessed
// original and one translation nobody owns.

export type Disclosure = {
  /// The exact sentence displayed. Never interpolated, never assembled — the
  /// record has to be able to reproduce it verbatim.
  readonly text: string
  /// Bumped when `text` changes, INDEPENDENTLY per locale. A Spanish
  /// correction must not silently re-date the English rows and vice versa.
  readonly version: string
}

/// PRD 05 CN-15 / §6.2. Account and payment texts. Unchecked by default
/// (D-10), and covering every element CN-15's AC lists: who is texting,
/// purpose, frequency, rates, opt-out, and that consent is not a condition of
/// rental — the last one matters most, since the checkbox sits right next to
/// fields that are required.
///
/// STOP and HELP stay English in both. They are not words, they are the
/// literal strings `classifyInboundSms` matches
/// (`packages/core/comms/sms-keywords.ts`), and a carrier's own keyword
/// handling is English by construction. Translating them would print an
/// instruction that does not work.
export const SMS_CONSENT: Record<Locale, Disclosure> = {
  en: {
    text: 'I agree to receive account and payment text messages (like payment reminders and gate codes) from this facility. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. This is not required to rent a unit.',
    version: 'v1',
  },
  es: {
    text: 'Acepto recibir mensajes de texto sobre mi cuenta y mis pagos (como recordatorios de pago y códigos de la puerta) de esta instalación. La frecuencia de los mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responda STOP para darse de baja, o HELP para obtener ayuda; estas dos palabras se escriben en inglés. Esto no es requisito para rentar una unidad.',
    version: 'v1-es',
  },
}

/// PRD 04 US-13 AC1 / US-9 AC3 (B-073). Unchecked by default, same as the SMS
/// consent above. This is the ONLY thing that makes the abandonment follow-up
/// (US-9) legal to send at all — "no consent, no sequence" — since a checkout
/// session has no other consent-capture point before it might be abandoned.
export const MARKETING_EMAIL_CHECKOUT_CONSENT: Record<Locale, Disclosure> = {
  en: {
    text: 'Send me occasional emails about pricing and promotions. You can unsubscribe any time. This is not required to rent a unit.',
    version: 'v1',
  },
  es: {
    text: 'Envíenme correos electrónicos ocasionales sobre precios y promociones. Puede darse de baja en cualquier momento. Esto no es requisito para rentar una unidad.',
    version: 'v1-es',
  },
}

/// PRD 04 US-13 AC1/AC3, D-51 (B-123). The MARKETING text lane, and the reason
/// it is a fourth checkbox rather than a clause bolted onto the SMS one above.
///
/// TCPA treats promotional texts differently from transactional ones: they need
/// express WRITTEN consent, and that consent must be to receive marketing
/// specifically — a tenant agreeing to gate codes by text has not agreed to be
/// texted about a sale, and merging the two would make it impossible to show
/// which they actually said yes to. The two lanes stay separate all the way
/// down: separate consent channel, separate disclosure, separate version,
/// separate opt-out, separate check at send time (`smsConsentGranted`).
///
/// The FCC's own conditions are the reason each clause is here: it names the
/// sender, says what will be sent, states that consent is not a condition of
/// purchase, gives the opt-out, and warns about rates.
///
/// **DRAFT COPY, and this one is not merely the usual D-10 caveat.** PRD 04's
/// own AC3 defers the final wording to legal review (Open Questions Q5), and
/// nothing may send on this lane until that lands AND a separate A2P 10DLC
/// MARKETING campaign is registered (PRD 05 §6.3) — a transactional
/// registration does not cover promotional traffic. D-51 records both, and
/// records that the lane ships dark because of them. Both versions carry
/// `-draft` for that reason, and both will move when the review lands.
export const MARKETING_SMS_CONSENT: Record<Locale, Disclosure> = {
  en: {
    text: 'I agree to receive marketing text messages about promotions and pricing from this facility at the number above. Consent is not a condition of renting. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.',
    version: 'v1-draft',
  },
  es: {
    text: 'Acepto recibir mensajes de texto promocionales sobre ofertas y precios de esta instalación al número indicado arriba. El consentimiento no es condición para rentar. La frecuencia de los mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responda STOP para darse de baja, o HELP para obtener ayuda; estas dos palabras se escriben en inglés.',
    version: 'v1-draft-es',
  },
}

/// PRD 02 US-13 / B-032. Consent to transact electronically, captured as the
/// `notice_email` consent at lease signing.
///
/// E-SIGN requires consent to transact electronically as its own affirmative
/// act — not something a signature implies — so this is deliberately separate
/// from the signature field and unticked by default.
///
/// **The Spanish says one thing the English does not, and that is deliberate.**
/// D-122 keeps the lease itself in English, so a Spanish renter is agreeing to
/// receive documents they cannot read in their own language. The English
/// reader needs no warning about that and the Spanish reader does, which is
/// precisely why a translated disclosure is a DIFFERENT disclosure and needs
/// its own version rather than a copy of `v1`. Adding the sentence here is the
/// honest reading of E-SIGN's own requirement that consent be informed.
export const ELECTRONIC_RECORDS_CONSENT: Record<Locale, Disclosure> = {
  en: {
    text: 'I agree to sign this agreement electronically and to receive my lease, receipts and notices by email rather than on paper. I can ask for a paper copy at any time.',
    version: 'v1',
  },
  es: {
    text: 'Acepto firmar este contrato electrónicamente y recibir mi contrato, mis recibos y mis avisos por correo electrónico en lugar de en papel. Puedo pedir una copia impresa en cualquier momento. El contrato y los avisos están únicamente en inglés.',
    version: 'v1-es',
  },
}
