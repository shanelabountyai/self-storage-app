import { headers } from 'next/headers'

/// Best-effort attribution, shared by every server action that records
/// consent, signature, or login evidence (US-13, CN-15, FR-4.2, US-701).
/// Behind a proxy the client address is the first entry of the forwarded
/// chain; it is evidence, not identity — and genuinely best-effort, not
/// required: `headers()` throws outside a real request scope (a direct test
/// call, a future background re-run), and a record missing only its
/// IP/user-agent is far better evidence than no record, or a hard failure, at
/// all.
export async function requestMetadata(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const bag = await headers()
    const forwarded = bag.get('x-forwarded-for')
    return { ipAddress: forwarded ? forwarded.split(',')[0].trim() : null, userAgent: bag.get('user-agent') }
  } catch {
    return { ipAddress: null, userAgent: null }
  }
}
