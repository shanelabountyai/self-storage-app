// PRD 02 §4.6 US-27 / US-13 (B-061). How a notice may be delivered, and the
// one delivery method that needs permission first.

export const NOTICE_DELIVERY_METHODS = [
  'certified_mail',
  'first_class_mail',
  'hand_delivered',
  'posted_on_unit',
  'email',
] as const

export type NoticeDeliveryMethod = (typeof NOTICE_DELIVERY_METHODS)[number]

export const DELIVERY_METHOD_LABELS: Readonly<Record<NoticeDeliveryMethod, string>> = {
  certified_mail: 'Certified mail',
  first_class_mail: 'First-class mail',
  hand_delivered: 'Hand delivered',
  posted_on_unit: 'Posted on the unit',
  email: 'Email',
}

/// Proof each method has to produce before delivery can be recorded.
///
/// Same shape and the same reasoning as the task catalog's
/// `requiredProofFields` (B-095): a delivery marked done with nothing behind it
/// is worse than no record, because it reads in a lien file as evidence.
export const DELIVERY_PROOF_FIELDS: Readonly<Record<NoticeDeliveryMethod, readonly string[]>> = {
  certified_mail: ['tracking_number'],
  first_class_mail: ['note'],
  hand_delivered: ['note'],
  // A photo, because "we posted it on the door" with nothing to show is the
  // claim a tenant most easily denies.
  posted_on_unit: ['photo_reference'],
  email: ['email_address'],
}

export function missingDeliveryProof(
  method: NoticeDeliveryMethod,
  proof: Record<string, unknown> | null,
): string[] {
  return DELIVERY_PROOF_FIELDS[method].filter((key) => {
    const value = proof?.[key]
    return typeof value !== 'string' || value.trim() === ''
  })
}

/// Whether a method sends the notice electronically, and therefore needs the
/// tenant's `notice_email` consent.
///
/// US-13's AC: "consent to receive notices by email is its own consent type,
/// distinct from `account_email` and from marketing consent... Texas permits
/// electronic notice only where the tenant agreed to it; overloading the
/// account-email consent destroys the ability to prove that agreement."
///
/// So the check is specifically against `notice_email` and nothing else. A
/// tenant who happily gets receipts by email has not thereby agreed to be
/// served a lien notice that way.
export function isElectronicDelivery(method: NoticeDeliveryMethod): boolean {
  return method === 'email'
}

export type DeliveryVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; missingProof?: string[] }

export type DeliveryCheckInput = {
  method: NoticeDeliveryMethod
  proof: Record<string, unknown> | null
  /// The tenant's current `notice_email` consent state — `null` when they have
  /// never been asked. Null and `revoked` are both refusals; they differ only
  /// in the message, because "they said no" and "nobody asked" need different
  /// fixes from whoever is standing at the counter.
  noticeEmailConsent: 'granted' | 'revoked' | null
}

export function canDeliver(input: DeliveryCheckInput): DeliveryVerdict {
  const missingProof = missingDeliveryProof(input.method, input.proof)
  if (missingProof.length > 0) {
    return {
      allowed: false,
      reason: `Recording ${DELIVERY_METHOD_LABELS[input.method].toLowerCase()} delivery needs: ${missingProof.join(', ')}.`,
      missingProof,
    }
  }

  if (isElectronicDelivery(input.method)) {
    if (input.noticeEmailConsent === null) {
      return {
        allowed: false,
        reason:
          'This tenant has never been asked to accept notices by email, so a notice cannot be served that way. ' +
          'Use mail, and capture notice-by-email consent separately if you want the option later.',
      }
    }
    if (input.noticeEmailConsent === 'revoked') {
      return {
        allowed: false,
        reason:
          'This tenant has withdrawn consent to receive notices by email. Serve this notice by mail.',
      }
    }
  }

  return { allowed: true }
}
