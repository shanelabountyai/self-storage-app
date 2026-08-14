import type { AuthAudience } from '@storage/db'

// One shared `/login` page serves both audiences (auth.config.ts's `pages.signIn`
// is the redirect target for both proxy.ts's staff gate and the portal's).
// Nothing in the form asks "are you staff or a tenant" — that would be one more
// thing to get wrong under a lockout message — so it is inferred from where the
// visitor was trying to go.

/// `from` is the path a gated route redirected here from (proxy.ts sets it for
/// `/admin/*`; the portal layout will do the same for `/portal/*`). Anything
/// else — arriving at `/login` directly with no `from` — defaults to tenant,
/// since the portal is this page's primary audience; a direct staff visit uses
/// the "Staff sign-in" link, which sets `from=/admin` for exactly this reason.
export function audienceFor(from: string | undefined): AuthAudience {
  return from?.startsWith('/admin') ? 'staff' : 'tenant'
}

/// The same reading, but honest about not knowing.
///
/// `audienceFor` has to return something because a redirect target must exist,
/// and its tenant default is right for that. It is wrong for deciding which
/// table to look an account up in, where "no `from`" means "nobody told us"
/// rather than "tenant" — see `resolveAudience` in lib/auth/accounts.ts for what
/// that default cost. Anything that resolves an ACCOUNT takes this and passes it
/// as a hint; anything that picks a REDIRECT keeps `audienceFor`.
export function audienceHint(from: string | undefined): AuthAudience | null {
  if (!from) return null
  return from.startsWith('/admin') ? 'staff' : 'tenant'
}

export function defaultRedirectFor(audience: AuthAudience): string {
  return audience === 'staff' ? '/admin' : '/portal'
}

/// Only ever redirect somewhere inside this app. `from`/`redirect` values ride
/// in a URL query string, which makes them attacker-controlled input — an
/// unchecked `redirectTo` is an open redirect (send a "sign in" link that
/// looks like ours and lands the victim on a phishing page after a real,
/// successful login).
export function safeRedirectTarget(candidate: string | undefined, audience: AuthAudience): string {
  if (candidate && candidate.startsWith('/') && !candidate.startsWith('//')) return candidate
  return defaultRedirectFor(audience)
}
