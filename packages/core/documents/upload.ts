// PRD 02 US-16 / PRD 01 US-705 (B-104 follow-up). Validating a file a TENANT
// uploaded, before any of it is trusted.
//
// This is the first place in the system where bytes arrive from the public
// internet and are kept. Everything below exists because one of the following
// is otherwise true:
//
//   - A browser sniffs an uploaded file as HTML and runs it from a URL the
//     tenant can send to somebody else. That is stored XSS, and the declared
//     `Content-Type` on the upload is attacker-controlled — so the type is
//     decided HERE from the bytes, not from what the form said.
//   - An SVG is treated as an image. SVG is a document format that can carry
//     script; it is deliberately not on the list.
//   - Somebody uploads a 2 GB file and the function times out holding it.
//
// Pure, so every rule is provable without a network or a storage vendor.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/// What a declaration page actually is: a PDF, or a photo of one.
///
/// A deliberately short list. Every addition is a new parser exposed to a file
/// somebody chose, and "my insurer sent me a .docx" is answered by asking for a
/// PDF rather than by accepting Word documents forever.
export const ACCEPTED_UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export type AcceptedUploadType = (typeof ACCEPTED_UPLOAD_TYPES)[number]

export type UploadProblem =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  /// The bytes do not match any type we accept — including the case where the
  /// form CLAIMED an accepted type and the content is something else.
  | 'content_mismatch'

export const UPLOAD_PROBLEM_MESSAGES: Record<UploadProblem, string> = {
  empty: 'That file was empty. Choose the file again.',
  too_large: `That file is bigger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. A photo of the page usually works — or ask your insurer for a smaller PDF.`,
  unsupported_type: 'Upload a PDF or a photo (JPG or PNG) of your declaration page.',
  content_mismatch:
    'That file does not look like a PDF or a photo. Check you picked the right file, and try again.',
}

/// The type the BYTES say they are, ignoring anything the upload claimed.
///
/// Magic numbers only, and only for the three formats on the list. Returns null
/// for anything else, which is what makes "an HTML file renamed to .png" a
/// rejection rather than a stored script.
export function sniffType(bytes: Uint8Array): AcceptedUploadType | null {
  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // PNG: 89 P N G \r \n 1A \n
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  return null
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

export type UploadVerdict =
  | { ok: true; mimeType: AcceptedUploadType; byteSize: number }
  | { ok: false; problem: UploadProblem }

/// The whole check, in the order that fails cheapest first.
export function checkUpload(input: {
  bytes: Uint8Array
  /// What the form said. Used only to reject early with a clearer message —
  /// never to decide the stored type.
  declaredType?: string | null
}): UploadVerdict {
  if (input.bytes.length === 0) return { ok: false, problem: 'empty' }
  if (input.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, problem: 'too_large' }

  if (
    input.declaredType &&
    !ACCEPTED_UPLOAD_TYPES.includes(input.declaredType as AcceptedUploadType)
  ) {
    return { ok: false, problem: 'unsupported_type' }
  }

  // The decision. A file that claimed `application/pdf` and is not one fails
  // here, which is the case the declared type exists to be checked against.
  const sniffed = sniffType(input.bytes)
  if (!sniffed) return { ok: false, problem: 'content_mismatch' }

  return { ok: true, mimeType: sniffed, byteSize: input.bytes.length }
}

/// A storage path that gives away nothing and collides with nothing.
///
/// The tenant's own filename is NOT used. It is attacker-controlled, may carry
/// path separators or a second extension, and "policy for 123 Oak Street.pdf"
/// in a URL is a small privacy leak on its own. `random` is supplied by the
/// caller so this stays pure.
export function storagePath(input: {
  facilityId: string
  documentType: string
  random: string
  mimeType: AcceptedUploadType
}): string {
  const extension =
    input.mimeType === 'application/pdf' ? 'pdf' : input.mimeType === 'image/png' ? 'png' : 'jpg'
  return `${input.facilityId}/${input.documentType}/${input.random}.${extension}`
}

/// What a person is shown as the document's name.
///
/// Their filename, stripped to something safe to render and to put in a
/// `Content-Disposition` header — no path separators, no control characters, no
/// quotes, and bounded. Falls back to a generic name rather than an empty one.
export function safeDisplayName(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback
  const cleaned = raw
    .replace(/[\\/]/g, ' ')
    // Control characters and quotes. Both matter for the same reason: this
    // string ends up inside a `Content-Disposition: attachment; filename="..."`
    // header, where a stray quote or a CR/LF lets the uploader write a header
    // of their own choosing.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"']/g, '')
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}
