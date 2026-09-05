// B-262 (D-123). The languages this product publishes in, defined once.
//
// It lives in `packages/core` rather than in `apps/web/lib/i18n` because the
// generated SEO copy is here — the city intros, the size intros, the facility
// FAQs — and it is generated per language. The app's `Locale` is now an alias
// of this type, so the two lists cannot drift; the alternative was a second
// `'en' | 'es'` union in the core package, which would compile perfectly on the
// day a third language was added to only one of them.
//
// The MESSAGE CATALOGUE stays in the app (`lib/i18n/en.ts`, `es.ts`): it is UI
// strings, it is enormous, and nothing in `packages/core` renders UI. What
// crosses the boundary is the list of languages, not the words.

export const MARKETING_LOCALES = ['en', 'es'] as const

export type MarketingLocale = (typeof MARKETING_LOCALES)[number]

export const DEFAULT_MARKETING_LOCALE: MarketingLocale = 'en'
