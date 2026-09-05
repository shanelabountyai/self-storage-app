'use client'

import { createContext, useContext, useMemo } from 'react'
import {
  DEFAULT_LOCALE,
  translate,
  type Dictionary,
  type Locale,
  type MessageKey,
} from '@/lib/i18n'
import { en } from '@/lib/i18n/en'

// B-090 part 6. How a client component reads a translated string.
//
// Server components take the dictionary from `getLocale()` directly and never
// touch this. Client components — the checkout steps, the search form — get it
// from one provider mounted in the public layout, rather than the dictionary
// being drilled through twelve components as a prop. It is the smaller diff
// and, more usefully, a new client component cannot forget to be passed one.
//
// The dictionary is a plain serialisable object, so handing it across the
// server/client boundary costs one JSON payload per page rather than a
// runtime.

type LocaleContextValue = { locale: Locale; dict: Dictionary }

/// Defaults to English rather than throwing on a missing provider: a client
/// component rendered outside the public layout (an error boundary, a portal
/// widget) should render readable English, not blow up.
const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  dict: en,
})

export function LocaleProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale
  dict: Dictionary
  children: React.ReactNode
}) {
  const value = useMemo(() => ({ locale, dict }), [locale, dict])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale
}

/// `const t = useT()` then `t('checkout.pay')` — the same call shape as the
/// server side's `t(...)`, so a string moving between a server and a client
/// component does not change how it is looked up.
export function useT() {
  const { dict } = useContext(LocaleContext)
  return (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
}
