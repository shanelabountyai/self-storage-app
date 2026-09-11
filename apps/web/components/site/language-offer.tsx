import { setLocaleAction } from '@/lib/i18n/actions'
import { dictionaryFor, translate } from '@/lib/i18n'

// B-290 (D-133). Spanish, OFFERED to a browser that prefers it on a visit where
// nobody has chosen a language yet. Offered and never switched: a bilingual
// visitor whose browser says `es` but who reads the web in English keeps the
// page they came for, and the cookie stays the one source of truth.
//
// Either answer sets `st_locale` through the toggle's own action. So it is asked
// once and never again, and it works with JavaScript off. The public layout
// renders it only when `shouldOfferSpanish()` says so.
//
// Written entirely in Spanish, whatever the page, because it exists for the
// person who cannot read the English around it. The whole region carries
// `lang="es"`, and its `aria-label` is Spanish too. B-286's rule is that `lang`
// never sits over a label in the other language; here the two agree (3.1.2).
//
// In normal flow at the top, never fixed or overlaid, so it cannot cover
// content at 320px or at 200% zoom (1.4.10, 1.4.13). It is a plain region with
// no live role: it is present from load, not news about something that just
// happened, so nothing announces it (4.1.3). It comes after the skip link in the
// DOM, so the first tab stop is unchanged (2.4.1).
export function LanguageOffer() {
  const dict = dictionaryFor('es')
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)
  const button =
    'border-input bg-background hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium'

  return (
    <section lang="es" aria-label={t('lang.label')} className="bg-muted border-b">
      <form
        action={setLocaleAction}
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2"
      >
        <p className="text-sm">{t('lang.offer')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="locale" value="es" className={button}>
            {t('lang.offerAccept')}
          </button>
          <button type="submit" name="locale" value="en" className={button}>
            {t('lang.offerDismiss')}
          </button>
        </div>
      </form>
    </section>
  )
}
