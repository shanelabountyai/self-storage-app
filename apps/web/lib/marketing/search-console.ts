import { createSign } from 'node:crypto'
import { readInspection, type InspectionPayload, type UrlIndexation } from '@storage/core/marketing'

// PRD 04 §7 Phase 2 (B-082 part 5). Talking to Google Search Console.
//
// Hand-rolled against the REST endpoints rather than pulling in `googleapis`,
// which is a ~50MB dependency carrying every Google product, to make two HTTP
// calls. A service-account JWT is a signed JSON blob and `node:crypto` signs it
// in fifteen lines.
//
// Nothing here throws. A report is a read-only screen and a missing credential
// or a Google outage must render as a page that says so, not as a 500 — that is
// the same rule the facility page's inventory read follows.
//
// **There is deliberately no simulator.** The gate hardware has one (D-4) and
// that is right, because a simulated gate is a device we control. A simulated
// index status is a claim about what GOOGLE has done with our pages, and
// fabricating it would put invented verdicts on a screen an operator makes
// decisions from. Unconfigured means the report shows nothing and says why —
// the same degraded state D-46 chose for the map.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

/// Google's own daily cap on URL inspection is 2,000, and this report is opened
/// by a person rather than a job, so the ceiling that matters is how long
/// somebody will wait. Sequential requests at ~200ms each means 40 URLs is
/// about eight seconds.
///
/// ponytail: a fixed cap and no pagination. The upgrade when a portfolio
/// outgrows it is storing each verdict with a timestamp and refreshing the
/// oldest slice per run, and the trigger is the sitemap exceeding this number —
/// which the report says out loud rather than silently truncating.
export const INSPECT_LIMIT = 40

export type SearchConsoleConfig = {
  clientEmail: string
  privateKey: string
  /// The Search Console *property*, which is not always the site origin —
  /// a domain property is `sc-domain:example.com` while a URL-prefix property
  /// is `https://example.com/`. Wrong value here is a 403 on every call, so it
  /// is configured rather than derived.
  siteUrl: string
}

export type ConfigResult =
  | { configured: true; config: SearchConsoleConfig }
  /// Names the variables that are missing, so the report can tell an operator
  /// exactly what to set rather than "not configured".
  | { configured: false; missing: string[] }

export function searchConsoleConfig(): ConfigResult {
  const clientEmail = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL
  // Vercel and most dashboards store a PEM as a single line with escaped
  // newlines. Un-escaping here rather than asking somebody to paste a
  // multi-line value into a web form: the signature fails with an opaque error
  // otherwise, and that error names neither the cause nor this variable.
  const privateKey = process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL

  const missing = [
    ['GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL', clientEmail],
    ['GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY', privateKey],
    ['GOOGLE_SEARCH_CONSOLE_SITE_URL', siteUrl],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string)

  if (missing.length > 0) return { configured: false, missing }
  return {
    configured: true,
    config: { clientEmail: clientEmail!, privateKey: privateKey!, siteUrl: siteUrl! },
  }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

/// A signed service-account assertion, which is what Google exchanges for an
/// access token.
///
/// One hour is Google's maximum and also the minimum worth asking for: the
/// token is held for the life of one request and thrown away.
function assertionFor(config: SearchConsoleConfig, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  )
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(config.privateKey)
  return `${header}.${claims}.${base64url(signature)}`
}

type TokenResult = { ok: true; token: string } | { ok: false; problem: string }

async function accessToken(config: SearchConsoleConfig): Promise<TokenResult> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertionFor(config, new Date()),
      }),
    })
    if (!response.ok) {
      // The status, never the body. Google's token errors echo parts of the
      // request, and this string is rendered on an admin screen.
      return { ok: false, problem: `Google refused the credentials (HTTP ${response.status}).` }
    }
    const body = (await response.json()) as { access_token?: string }
    if (!body.access_token) return { ok: false, problem: 'Google returned no access token.' }
    return { ok: true, token: body.access_token }
  } catch {
    // A signing failure lands here too — a malformed PEM throws inside
    // `createSign`, and it is the single most likely misconfiguration.
    return {
      ok: false,
      problem: 'Could not reach Google, or the private key is not a valid PEM.',
    }
  }
}

export type InspectionOutcome =
  | { ok: true; rows: UrlIndexation[]; truncated: number }
  | { ok: false; problem: string }

/// Inspects up to `INSPECT_LIMIT` URLs.
///
/// Sequential rather than parallel, deliberately: the endpoint is rate-limited
/// per minute as well as per day, and a burst of forty concurrent requests is
/// the shape that earns a 429 for the whole property rather than for one call.
export async function inspectUrls(urls: string[]): Promise<InspectionOutcome> {
  const configured = searchConsoleConfig()
  if (!configured.configured) {
    return { ok: false, problem: `Not configured: ${configured.missing.join(', ')}` }
  }

  const token = await accessToken(configured.config)
  if (!token.ok) return { ok: false, problem: token.problem }

  const wanted = urls.slice(0, INSPECT_LIMIT)
  const rows: UrlIndexation[] = []

  for (const url of wanted) {
    try {
      const response = await fetch(INSPECT_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ inspectionUrl: url, siteUrl: configured.config.siteUrl }),
      })

      if (!response.ok) {
        // Per URL, not per report: one 403 on a URL outside the property must
        // not blank the other thirty-nine rows.
        rows.push({
          url,
          state: 'error',
          coverageState: null,
          lastCrawledAt: null,
          problem:
            response.status === 403
              ? 'The service account cannot read this property. Add it as a user in Search Console.'
              : `Google answered HTTP ${response.status}.`,
        })
        continue
      }

      rows.push(readInspection(url, (await response.json()) as InspectionPayload))
    } catch {
      rows.push({
        url,
        state: 'error',
        coverageState: null,
        lastCrawledAt: null,
        problem: 'Could not reach Google for this URL.',
      })
    }
  }

  return { ok: true, rows, truncated: Math.max(0, urls.length - wanted.length) }
}
