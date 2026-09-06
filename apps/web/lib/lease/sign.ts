import { prisma } from '@storage/db'
import { hashContent } from '@/lib/documents/render'
import type { KeyedFieldErrors } from '@/lib/admin/form-state'
import { signatureMatchesName } from './template'

// PRD 01 FR-4.2. Capturing a signature, and the evidence that goes with it.

export type SignInput = {
  documentId: string
  typedName: string
  legalName: string
  consented: boolean
  ipAddress?: string | null
  userAgent?: string | null
}

/// B-263: returns message KEYS. The legal name travels as a variable rather
/// than baked into a sentence, which is what lets the Spanish lease step
/// refuse a mistyped signature in Spanish.
export function validateSignature(input: {
  typedName?: string
  legalName: string
  consented?: boolean
}): KeyedFieldErrors {
  const errors: KeyedFieldErrors = {}

  const typed = input.typedName?.trim() ?? ''
  if (typed === '') {
    errors.typedName = { key: 'err.typedNameEmpty', vars: { name: input.legalName } }
  } else if (!signatureMatchesName(typed, input.legalName)) {
    // Catches the common real error (initials, "yes") without rejecting a
    // genuine variant like an included or omitted middle name.
    errors.typedName = { key: 'err.typedNameMismatch', vars: { name: input.legalName } }
  }

  if (!input.consented) {
    // Its own affirmative act under E-SIGN, so its own error — never folded
    // into the signature field, and never a disabled button.
    errors.consented = { key: 'err.consented' }
  }

  return errors
}

export type SignResult =
  | { ok: true; signatureId: string; signedAt: Date }
  | { ok: false; reason: 'document_not_found' | 'already_signed' | 'document_changed' }

/// Records a signature against a document.
///
/// The hash is re-read from the stored document rather than taken from the
/// caller: the signature has to bind what is actually on file, and a hash
/// passed in through a form is a hash the signer could choose. If the stored
/// document has drifted from its own recorded hash, signing is refused — a
/// signature over a document that already changed is worse than no signature.
export async function signDocument(input: SignInput): Promise<SignResult> {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.findUnique({
      where: { id: input.documentId },
      include: { signature: true },
    })
    if (!document || document.content === null) {
      return { ok: false as const, reason: 'document_not_found' as const }
    }
    // Signing twice is not an error the renter should see, but it must not
    // overwrite the first signature's evidence.
    if (document.signature) return { ok: false as const, reason: 'already_signed' as const }
    if (hashContent(document.content) !== document.contentHash) {
      return { ok: false as const, reason: 'document_changed' as const }
    }

    const signature = await tx.documentSignature.create({
      data: {
        documentId: document.id,
        typedName: input.typedName.trim(),
        consentedToElectronicRecords: input.consented,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        signedContentHash: document.contentHash,
      },
    })

    return { ok: true as const, signatureId: signature.id, signedAt: signature.signedAt }
  })
}

export type SignatureVerdict =
  | { ok: true; signedAt: Date; typedName: string }
  | { ok: false; reason: 'unsigned' | 'document_missing' | 'altered_since_signing' }

/// What an audit or a dispute asks: did this person sign, and is this the
/// document they signed?
export async function verifySignature(documentId: string): Promise<SignatureVerdict> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { signature: true },
  })
  if (!document || document.content === null) return { ok: false, reason: 'document_missing' }
  if (!document.signature) return { ok: false, reason: 'unsigned' }

  // Compares against the hash captured AT SIGNING, not the document's current
  // one — if someone updated both together, this still catches it.
  if (hashContent(document.content) !== document.signature.signedContentHash) {
    return { ok: false, reason: 'altered_since_signing' }
  }

  return {
    ok: true,
    signedAt: document.signature.signedAt,
    typedName: document.signature.typedName,
  }
}

