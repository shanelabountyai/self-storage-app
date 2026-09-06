import {
  dictionaryFor,
  LOCALE_NAMES,
  LOCALES,
  translate,
  type Locale,
} from '@/lib/i18n'
import { hasSpanishTwin, localePath } from '@/lib/i18n/routing'

// B-090 part 6, rewritten by B-262 (D-123). The control that switches the
// site's language.
//
// It used to be a form that set a cookie and re-rendered the same URL. Since
// the locale lives in the path, it is a LINK to the same page's other URL —
// which is not a smaller version of the same control but a different and better
// one: the address bar now says which language you are reading, and the link a
// Spanish speaker copies stays Spanish for whoever opens it. It still works
// with JavaScript off, for the same reason the checkout steps are forms.
//
// **A plain `<a>`, deliberately, and NOT `next/link`.** The root layout is what
// carries `<html lang>`, and Next does not re-render it on a client-side
// navigation — it is shared across the transition by design. So with `<Link>`
// the toggle swapped every word on the page into Spanish and left the document
// announced as `lang="en"`: SC 3.1.1 Language of Page, failed by the one
// control on the site whose entire job is to change the language. It renders
// correctly on a full load, so it is invisible to anything that navigates by
// URL — the e2e caught it only because it CLICKS.
//
// The cost is a document navigation on a control somebody presses roughly once
// per visit, which is the right side of that trade.
//
// One link per language rather than a `<select>` that needs a submit button
// beside it, because there are two languages and there will not be three soon;
// a two-option select is a worse control than two targets at every width. The
// current language is `aria-current="page"` and still a link — dropping the
// anchor would remove it from the tab order, and a keyboard user checking which
// language they are in is exactly who needs to reach it. `page` rather than
// `true` because these now genuinely are page links.
//
// The language name is written in its own language and never translated
// (`LOCALE_NAMES`): "Spanish" is unreadable to the person who needs it.
// Each link carries `lang` so a screen reader pronounces "Español" with
// Spanish phonemes inside an English page — WCAG 3.1.2 Language of Parts (AA),
// which is exactly the case this control creates.
export function LanguageToggle({ locale, path }: { locale: Locale; path: string }) {
  const dict = dictionaryFor(locale)

  // On a page with no Spanish twin — `/terms`, `/privacy`, `/messaging-policy`
  // — the toggle would otherwise offer a URL the proxy immediately redirects
  // back, which reads as the control being broken. It sends you to the Spanish
  // homepage instead, and the footer already says in Spanish why the legal
  // pages are not translated.
  const twinTarget = hasSpanishTwin(path) ? path : '/'

  return (
    <div
      role="group"
      aria-label={translate(dict, 'lang.label')}
      className="flex items-center"
    >
      {LOCALES.map((candidate) => {
        const current = candidate === locale
        return (
          <a
            key={candidate}
            href={localePath(candidate, twinTarget)}
            hrefLang={candidate}
            lang={candidate}
            aria-current={current ? 'page' : undefined}
            aria-label={
              current
                ? undefined
                : translate(dict, 'lang.switchTo', {
                    language: LOCALE_NAMES[candidate],
                  })
            }
            className={`hover:bg-accent inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
              current ? 'underline underline-offset-4' : 'text-muted-foreground'
            }`}
          >
            {LOCALE_NAMES[candidate]}
          </a>
        )
      })}
    </div>
  )
}
