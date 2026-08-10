'use server'

import { redirect } from 'next/navigation'
import { verifyUnsubscribeToken } from '@/lib/comms/unsubscribe-token'
import { suppress } from '@/lib/comms/service'

// PRD 05 US-13 AC2: "unsubscribe takes effect immediately in our system."
//
// A POST behind a button, not a bare GET — a link scanner or an email
// client's own prefetch hitting this on GET must not silently unsubscribe
// someone who never clicked anything. The page's own next render is what
// shows the result; there is nothing else caching this to invalidate.
export async function confirmUnsubscribeAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const verdict = verifyUnsubscribeToken(token)
  if (verdict.valid) {
    await suppress({ channel: 'email', address: verdict.address, reason: 'unsubscribe' })
  }
  redirect(`/unsubscribe/${token}?done=1`)
}
