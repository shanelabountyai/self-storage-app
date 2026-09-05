import Link from 'next/link'
import { getLocale } from '@/lib/i18n/server'
import { localePath } from '@/lib/i18n/routing'

// B-262 (D-123). An internal link that stays in the language you are reading.
//
// Since the locale lives in the path, a plain `<Link href="/storage/search">`
// on a Spanish page navigates to the ENGLISH search. It is the one failure the
// cookie strategy did not have, and it is silent: the link works, the page
// renders, and the visitor is simply back in English with nothing to report.
// Under a cookie there was no such thing as a link that lost the language.
//
// An async server component rather than a `href={localePath(locale, …)}` call
// at each site, and the nested helpers are why. Several of these links live
// inside plain functions further down their page file — a card renderer, a
// results row — which have no locale in scope and would each have to be given
// one. Reading it here is one import per file instead of a prop threaded
// through every intermediate, and a new link cannot forget to be passed
// something it never takes.
//
// `href` is an UNPREFIXED, root-relative path. Anything else — an absolute URL,
// a bare `?` query link, a fragment — passes through untouched; see
// `localePath`.
export async function LocaleLink({
  href,
  children,
  ...rest
}: React.ComponentProps<typeof Link>) {
  const locale = await getLocale()
  return (
    <Link href={typeof href === 'string' ? localePath(locale, href) : href} {...rest}>
      {children}
    </Link>
  )
}
