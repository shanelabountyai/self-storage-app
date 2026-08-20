// PRD 04 §7 Phase 3 (B-087 part 1): "IndexNow/sitemap ping automation."
//
// **The "sitemap ping" half of that sentence no longer exists.** Google retired
// its `/ping?sitemap=` endpoint in 2023 and it now returns 404; Bing retired
// theirs in favour of this. So the automation the PRD asks for is IndexNow and
// only IndexNow — one POST that Bing, Yandex, Seznam and Naver all read from
// the same shared endpoint. Google does not participate. That is a real
// reduction in what this buys and it is written down rather than papered over:
// for Google, the sitemap plus B-082 part 5's indexation report remain the
// whole story.
//
// No simulator, same rule as the Search Console client: unconfigured submits
// nothing and says which variable is missing.

import { absoluteUrl } from '@storage/core/marketing'

/// The shared endpoint. One submission reaches every participating engine —
/// posting to each engine's own host as well is explicitly discouraged by the
/// protocol and would just be the same URLs four times.
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

/// The protocol's own cap is 10,000 URLs per request. This is far below it and
/// exists for a different reason: a submission of every URL we have is the
/// shape that gets a host rate-limited, and this job is meant to submit what
/// CHANGED.
///
/// ponytail: a fixed cap with no batching. The upgrade is chunking into
/// requests of 10,000, and the trigger is a day's changed-URL count reaching
/// this number — which the job reports rather than silently truncating.
export const SUBMIT_LIMIT = 500

export type IndexNowConfig = { key: string }

export type IndexNowConfigResult =
  | { configured: true; config: IndexNowConfig }
  | { configured: false; missing: string[]; problem?: string }

/// The key is NOT a secret — the protocol requires it to be publicly readable
/// at a URL on the same host, which is exactly how ownership is proved. It
/// lives in an environment variable anyway because it is per-deployment: a
/// preview build submitting a production host's URLs is worse than one that
/// submits nothing.
export function indexNowConfig(): IndexNowConfigResult {
  const key = process.env.INDEXNOW_KEY?.trim()
  if (!key) return { configured: false, missing: ['INDEXNOW_KEY'] }

  // Validated here rather than discovered as a 422 from an endpoint that
  // answers with an empty body. 8–128 characters of `[a-zA-Z0-9-]` is the
  // protocol's own rule.
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
    return {
      configured: false,
      missing: [],
      problem: 'INDEXNOW_KEY must be 8–128 characters of letters, digits and hyphens.',
    }
  }
  return { configured: true, config: { key } }
}

/// Where the key file is served from.
///
/// The protocol's default location is `/{key}.txt` at the host root, which
/// would mean a dynamic catch-all route directly under `/` — a route that
/// shadows every future top-level path. `keyLocation` in the payload exists
/// precisely to allow another path, so the file lives under a fixed segment
/// and nothing at the root is claimed.
export function indexNowKeyPath(key: string): string {
  return `/indexnow/${key}.txt`
}

export type SubmitResult = {
  submitted: number
  ok: boolean
  /// Null on success. Set for every failure mode including "not configured",
  /// so a caller has one field to report.
  problem: string | null
  /// True when the cap was hit and URLs were left out — reported rather than
  /// silently dropped.
  truncated: boolean
}

/// Submits changed URLs. Never throws: this runs inside a scheduled job whose
/// other work must not be lost to a search engine having a bad afternoon.
export async function submitUrls(origin: string, urls: readonly string[]): Promise<SubmitResult> {
  const configured = indexNowConfig()
  if (!configured.configured) {
    return {
      submitted: 0,
      ok: false,
      problem: configured.problem ?? `not configured (${configured.missing.join(', ')})`,
      truncated: false,
    }
  }
  if (urls.length === 0) return { submitted: 0, ok: true, problem: null, truncated: false }

  const capped = urls.slice(0, SUBMIT_LIMIT)
  const host = new URL(origin).host

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key: configured.config.key,
        keyLocation: absoluteUrl(origin, indexNowKeyPath(configured.config.key)),
        urlList: capped,
      }),
    })

    // 200 and 202 are both success — 202 means "accepted, key not yet
    // verified", which is the normal answer on a host's first ever submission
    // and must not read as a failure the first time this runs.
    if (response.status !== 200 && response.status !== 202) {
      return {
        submitted: 0,
        ok: false,
        // 403 means the key file did not match, and it is the one failure an
        // operator can actually fix, so the status is named rather than
        // summarised as "rejected".
        problem: `IndexNow answered ${response.status}${response.status === 403 ? ' — the key file did not match INDEXNOW_KEY' : ''}.`,
        truncated: false,
      }
    }

    return { submitted: capped.length, ok: true, problem: null, truncated: capped.length < urls.length }
  } catch (error) {
    return {
      submitted: 0,
      ok: false,
      problem: `IndexNow was unreachable: ${error instanceof Error ? error.message : String(error)}`,
      truncated: false,
    }
  }
}
