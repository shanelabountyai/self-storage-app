import { indexNowConfig, indexNowKeyPath } from '@/lib/marketing/indexnow'

// PRD 04 §7 Phase 3 (B-087 part 1). The IndexNow key file.
//
// The protocol proves host ownership by requiring a publicly readable file, on
// the host being submitted for, whose contents are the key itself. Serving it
// from the same environment variable the submitter signs with is the point:
// two copies of a key are two things that can disagree, and the failure mode
// when they do is a 403 on every submission with no other symptom.

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const configured = indexNowConfig()

  // A 404 for any path but the configured key's own — including when nothing
  // is configured. The file is a secret in exactly one sense: serving the key
  // from an arbitrary requested path would let anyone claim ownership of this
  // host by choosing their own key, which is the whole attack this file exists
  // to prevent.
  if (!configured.configured || indexNowKeyPath(configured.config.key) !== `/indexnow/${key}`) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(configured.config.key, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Verified on submission, so a cached copy is fine and a re-fetch per
      // submission is not worth the round trip.
      'cache-control': 'public, max-age=3600',
    },
  })
}
