import { currentImpersonation } from '@/lib/impersonation/context'
import { ImpersonationCountdown } from './countdown'

/// PRD 09 FR-14/FR-15 (B-091 part 2). The persistent banner.
///
/// Rendered by both shells — `/portal` for a tenant subject, `/admin` for a
/// staff one — and returns null when no session is running, so a layout adds
/// one line rather than a condition.
///
/// **Not dismissible, and there is no control that hides it.** FR-14 says
/// persistent; the accessibility half of that (FR-15) is why it is also FIRST
/// in the document, ahead of the skip link: a screen-reader user who lands on a
/// portal page must not read a tenant's balance for several seconds before
/// finding out whose balance it is. `role="alert"` asks for it to be announced
/// on arrival as well; being first in reading order is what makes the guarantee
/// hold on the engines that only announce live regions on change.
///
/// `sticky` rather than `fixed`: same result at the top of the viewport, and it
/// does not require every page under it to carry a matching top padding — a
/// gap that would be invisible until some future screen forgot it.
export async function ImpersonationBanner() {
  const impersonation = await currentImpersonation()
  if (!impersonation) return null

  const endsAt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(impersonation.expiresAt)

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 bg-amber-900 text-white print:static"
      data-testid="impersonation-banner"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <p className="text-pretty">
          <span className="font-semibold">Support session —</span> you are viewing this as{' '}
          <strong>{impersonation.subjectName}</strong>
          {impersonation.subjectType === 'tenant' ? ' (tenant)' : ' (staff)'}.{' '}
          <span className="font-semibold">Read-only:</span> nothing can be changed, sent, or paid.
        </p>

        <p className="ml-auto whitespace-nowrap">
          <ImpersonationCountdown expiresAt={impersonation.expiresAt.toISOString()} />
          <span className="sr-only">This session ends automatically at {endsAt}.</span>
        </p>

        {/* A plain form to the route handler, not a server action: server
            actions POST to the current page, and the write block refuses every
            POST that is not on the exemption list by path (lib/impersonation/
            request.ts). The way out cannot be something the session blocks. */}
        <form method="post" action="/api/impersonation/end">
          <button
            type="submit"
            className="ring-offset-amber-900 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md bg-white px-3 py-1 font-medium text-amber-950 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Return to my account
          </button>
        </form>
      </div>
    </div>
  )
}
