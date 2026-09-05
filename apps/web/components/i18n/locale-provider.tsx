'use client'

import { createContext, useContext, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import {
  DEFAULT_LOCALE,
  translate,
  type Dictionary,
  type Locale,
  type MessageKey,
} from '@/lib/i18n'
import { en } from '@/lib/i18n/en'
import { localePath, splitLocalePath } from '@/lib/i18n/routing'

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

/// B-262. The locale-aware half of `usePathname()`, for a client component that
/// renders internal links or highlights the route it is on.
///
/// Both values come off the BROWSER's path rather than the context, because
/// that is the one thing a client component can be sure of: `proxy.ts` rewrites
/// `/es/portal` onto `/portal` for rendering, but the client router still sees
/// `/es/portal`, so `usePathname().startsWith('/portal')` is false on every
/// Spanish page. That mismatch is silent — the links still work, they just stop
/// being marked current and quietly drop the visitor into English on the next
/// click.
///
/// `path` is the pathname with the prefix off, for comparing against a route
/// constant. `href()` puts it back on, for building a link.
export function useLocaleRoute(): {
  locale: Locale
  path: string
  href: (to: string) => string
} {
  const pathname = usePathname()
  const { locale, path } = splitLocalePath(pathname)
  return { locale, path, href: (to: string) => localePath(locale, to) }
}
