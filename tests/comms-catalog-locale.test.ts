import { describe, expect, it } from 'vitest'
import { COMMS_TEMPLATES } from '../packages/db/comms-catalog'
import { LOCALES } from '../apps/web/lib/i18n'
import { COMMS_PROSE } from '../apps/web/lib/comms/prose'

// B-261 (D-122). The Spanish half of the seeded catalog, checked against the
// English half.
//
// This is the guard for the trap the backlog row named and B-206 already paid
// for once: a template's `requiredMergeFields` must be satisfiable in BOTH
// languages, or `renderEmail` throws a `RenderError` and the message is
// recorded `failed` — which reads exactly like a broken sender, at 2am, in a
// job, on the dunning ladder. Nothing else catches it. The seed does not, the
// typechecker cannot (the bodies are strings), and a manual read of 48
// templates × 2 languages will miss one.
//
// It is a pure test on purpose: the catalog is a constant, so this fails on
// the branch that introduces the mistake rather than after `db:migrate:test`
// has been remembered.

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g
const fieldsIn = (text: string) => new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]))

const named = (template: (typeof COMMS_TEMPLATES)[number]) =>
  `${template.key}/${template.channel ?? 'email'}`

describe('the seeded comms catalog, per locale', () => {
  it('has a Spanish variant for every template', () => {
    // Not a nice-to-have: `effectiveTemplate` falls back to English, so a
    // missing variant SILENTLY ships an English email to a Spanish tenant.
    // The fallback exists so a send is never withheld — not as a place for
    // untranslated content to sit unnoticed.
    const missing = COMMS_TEMPLATES.filter((template) => !template.es).map(named)
    expect(missing).toEqual([])
  })

  for (const template of COMMS_TEMPLATES) {
    const label = named(template)

    describe(label, () => {
      const english = new Set([
        ...fieldsIn(template.bodyText),
        ...fieldsIn(template.subject ?? ''),
      ])

      it('declares only merge fields its English document actually uses', () => {
        expect([...template.requiredMergeFields].filter((field) => !english.has(field))).toEqual([])
      })

      it('resolves the same merge fields in Spanish as in English', () => {
        const es = template.es
        expect(es, 'no Spanish variant').toBeDefined()
        const spanish = new Set([
          ...fieldsIn(es!.bodyText),
          ...fieldsIn(es!.subject ?? template.subject ?? ''),
        ])

        // A required field the Spanish body drops: `renderEmail` throws and
        // the send is recorded `failed`.
        expect([...template.requiredMergeFields].filter((f) => !spanish.has(f))).toEqual([])
        // A placeholder only the Spanish has: nothing supplies it, so
        // `renderString`'s unresolved-placeholder guard throws — same failure,
        // opposite cause.
        expect([...spanish].filter((f) => !english.has(f))).toEqual([])
        // A field only the English has is not a crash, but it is a Spanish
        // reader losing a fact the English reader gets — the gate code, the
        // amount, the date.
        expect([...english].filter((f) => !spanish.has(f))).toEqual([])
      })

      it('keeps the schema rule that an SMS row has no subject', () => {
        if ((template.channel ?? 'email') !== 'sms') return
        expect(template.subject).toBeUndefined()
        expect(template.es?.subject).toBeUndefined()
      })

      it('is actually written in Spanish, not copied from the English', () => {
        // Catches the paste that leaves an English body under an `es` key —
        // which would otherwise pass every check above, because a copy shares
        // its merge fields exactly.
        expect(template.es!.bodyText).not.toBe(template.bodyText)
      })
    })
  }
})

describe('the code-built sentences (lib/comms/prose.ts)', () => {
  // `Record<Locale, CommsProse>` already makes a missing LANGUAGE a typecheck
  // failure. What it cannot catch is a key filled in by pasting the English,
  // which is the likelier mistake and the one that produces a Spanish email
  // with English sentences inside it — exactly what this item exists to end.
  it('says something different in each language', () => {
    const identical: string[] = []
    for (const [key, english] of Object.entries(COMMS_PROSE.en)) {
      const spanish = (COMMS_PROSE.es as Record<string, unknown>)[key]
      if (typeof english === 'string') {
        if (english === spanish) identical.push(key)
      } else if (Array.isArray(english)) {
        english.forEach((line, index) => {
          if (line === (spanish as unknown[])[index]) identical.push(`${key}[${index}]`)
        })
      } else if (typeof english === 'object' && english !== null) {
        for (const [inner, value] of Object.entries(english)) {
          if (value === (spanish as Record<string, unknown>)[inner]) identical.push(`${key}.${inner}`)
        }
      }
    }
    // `paymentMethods.ach` is the one legitimate collision candidate and is
    // not one ("bank transfer" / "transferencia bancaria"). Anything landing
    // here is an untranslated paste.
    expect(identical).toEqual([])
  })

  it('covers every locale the app offers', () => {
    expect(Object.keys(COMMS_PROSE).sort()).toEqual([...LOCALES].sort())
  })

  it('escalates the dunning ladder over four rungs in both languages', () => {
    // The ladder is index-aligned across languages by contract —
    // `delinquency.day_reached` picks a rung by position, so a Spanish array
    // of a different length would silently serve the wrong severity.
    for (const locale of LOCALES) {
      expect(COMMS_PROSE[locale].dunningTone).toHaveLength(4)
      expect(COMMS_PROSE[locale].dunningConsequence).toHaveLength(4)
    }
  })
})
