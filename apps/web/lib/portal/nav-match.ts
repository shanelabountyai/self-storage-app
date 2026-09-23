/// B-372. One "is this the current page" rule for the portal's header nav and
/// its tab bar. `/portal` is exact (every route starts with it). Everything
/// else matches on a whole path SEGMENT: `/portal/pay` is not a prefix of
/// `/portal/payment-plan`, which the plain `startsWith` these navs used said it
/// was. The query and fragment never participate: the Pay link carries `?lease=`.
export function isPortalPathActive(pathname: string, href: string): boolean {
  const path = href.split(/[?#]/)[0]
  return path === '/portal' ? pathname === '/portal' : pathname === path || pathname.startsWith(`${path}/`)
}
