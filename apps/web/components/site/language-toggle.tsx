import { setLocaleAction } from '@/lib/i18n/actions'
import {
  dictionaryFor,
  LOCALE_NAMES,
  LOCALES,
  translate,
  type Locale,
} from '@/lib/i18n'

// B-090 part 6. The control that switches the site's language.
//
// One button per language rather than a `<select>` that needs a submit button
// beside it, because there are two languages and there will not be three
// soon; a two-option select is a worse control than two buttons at every
// width. The current language is `aria-current="true"` and still a button —
// disabling it would remove it from the tab order, and a keyboard user
// checking which language they are in is exactly who needs to reach it.
//
// The language name is written in its own language and never translated
// (`LOCALE_NAMES`): "Spanish" is unreadable to the person who needs it.
// B-286. `lang` never sits on an element that also has an `aria-label`: the
// label wins the accessible name, so the other language's button would declare
// `lang="es"` over English prose. The current button has no label, so its
// visible name carries `lang`; the other wraps its visible name in a
// `lang`-declared span. The language name embedded in the label stays
// unmarked, which is where 3.1.2's proper-name exception applies. Whether
// 3.1.2 required any of this is arguable either way (see the row).
export function LanguageToggle({ locale }: { locale: Locale }) {
  const dict = dictionaryFor(locale)

  return (
    <form action={setLocaleAction} className="contents">
      <div
        role="group"
        aria-label={translate(dict, 'lang.label')}
        className="flex items-center"
      >
        {LOCALES.map((candidate) => {
          const current = candidate === locale
          return (
            <button
              key={candidate}
              type="submit"
              name="locale"
              value={candidate}
              lang={current ? candidate : undefined}
              aria-current={current ? 'true' : undefined}
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
              {current ? (
                LOCALE_NAMES[candidate]
              ) : (
                <span lang={candidate}>{LOCALE_NAMES[candidate]}</span>
              )}
            </button>
          )
        })}
      </div>
    </form>
  )
}
