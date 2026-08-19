'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, type FormState } from '@/lib/admin/form-state'
import { currentImpersonation } from '@/lib/impersonation/context'
import { IMPERSONATION_COOKIE } from '@/lib/impersonation/request'
import { IMPERSONATION_TTL_MINUTES, startImpersonation } from '@/lib/impersonation/service'

/// PRD 09 FR-1/FR-2 (B-091 part 2). Starting a session, from a profile the
/// actor is already looking at — never from a box you type an email into.
///
/// One file for both subject types because they differ in a single argument;
/// the tenant profile and the staff-security screen import the one they need.

async function start(
  subjectType: 'tenant' | 'staff',
  formData: FormData,
  landing: string,
): Promise<FormState> {
  const actor = await requireStaffActor()

  const subjectId = String(formData.get('subjectId') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim()
  const ticketRef = String(formData.get('ticketRef') ?? '').trim()

  // FR-2 is enforced in the service too (`impersonation.started` is a
  // requiresReason action and the row is NOT NULL). Checked here as well so the
  // person gets it on the field rather than as a thrown MissingReasonCodeError,
  // which renders an error page and tells a screen-reader user nothing (B-094).
  if (!reason) {
    return fieldError({ reason: 'Say why you need to see this account, e.g. "Ticket 412 — card declined".' })
  }
  if (!subjectId) {
    return fieldError({ subjectId: 'Choose whose account to view.' })
  }

  const forwarded = (await headers()).get('x-forwarded-for')

  const result = await startImpersonation(actor, {
    subjectType,
    subjectId,
    reason,
    ticketRef: ticketRef || null,
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : null,
    // FR-4. The proxy already refuses this POST while a session is running, so
    // this is the second of two — and it is the one that holds for a caller
    // that is not a browser request at all.
    alreadyImpersonating: Boolean(await currentImpersonation()),
  })

  if (!result.ok) {
    // The guard's own message, verbatim, as the form's SUMMARY rather than as a
    // field error. Every refusal it produces is written for the person reading
    // it (see lib/impersonation/guard.ts), and rewording them here would give
    // the same refusal two vocabularies.
    //
    // Deliberately not `fieldError({ subjectId })`: on the tenant profile
    // `subjectId` is a hidden input, so a message attached to it renders
    // nowhere and the form reports only "There is a problem with one field"
    // about a field the person cannot see. None of these refusals is about a
    // field anyway — the rank rule, the scope rule and SR-7's throttle are all
    // statements about the request as a whole.
    return { status: 'error', message: result.message, fieldErrors: {} }
  }

  // The cookie carries the id and nothing else — the row is the authority
  // (§6.1), and `currentImpersonation()` refuses any row that does not name
  // this staff user as its impersonator.
  //
  // `maxAge` matches the TTL so an untouched session takes its cookie with it
  // when it expires. That is a tidiness measure, not the control: expiry is
  // enforced server-side on every request (FR-3), and the shells clear a stale
  // cookie eagerly because its presence alone blocks writes.
  const store = await cookies()
  store.set(IMPERSONATION_COOKIE, result.sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: IMPERSONATION_TTL_MINUTES * 60,
  })

  redirect(landing)
}

export async function startTenantImpersonationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // FR-22/D-13d: the real portal at its real URL, not a copy inside the admin
  // shell. The bugs people phone about — a control that does not respond, a
  // layout that breaks at 360px — are the ones an embedded reproduction hides.
  return start('tenant', formData, '/portal')
}

export async function startStaffImpersonationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return start('staff', formData, '/admin')
}
