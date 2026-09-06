// PRD 05 CN-14 (B-074). The exact carrier-standard keyword sets the AC names.
// Matched the same way Twilio's own Advanced Opt-Out does: the WHOLE message
// body, trimmed and case-insensitive — "please stop" is not a STOP, the same
// way it is not one to a carrier's own filter.

/// Published on `/messaging-policy` in the order a reader meets them: STOP
/// first, because it is the one every carrier message names, then the rest.
///
/// B-262 exported these. The policy page had retyped both lists as literal
/// JSX, under a comment claiming every word on it comes from the code — so
/// adding a keyword here would have left the public page quietly naming five
/// of six, which is the failure that page exists to prevent. The Set is built
/// FROM the array so there is one list and not two.
export const SMS_STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'] as const

const STOP_KEYWORDS = new Set<string>(SMS_STOP_KEYWORDS)

/// START and UNSTOP are the carrier-standard RESUME keywords, and they take
/// effect immediately — carriers require that, and a person who already opted
/// in once and then stopped is not somebody to ask twice.
export const SMS_START_KEYWORDS = ['START', 'UNSTOP'] as const

const START_KEYWORDS = new Set<string>(SMS_START_KEYWORDS)

/// The keywords that BEGIN an opt-in. Deliberately separate from the resume
/// set: these start a double opt-in and do not subscribe anybody on their own.
const OPT_IN_KEYWORDS = new Set(['JOIN', 'SUBSCRIBE'])

/// The reply that completes it. On its own — with nothing pending — it means
/// nothing, which is what makes the two-step real rather than decorative.
const CONFIRM_KEYWORDS = new Set(['YES', 'Y'])

export const SMS_HELP_KEYWORD = 'HELP'

const HELP_KEYWORDS = new Set([SMS_HELP_KEYWORD])

/// The keyword published as the way to opt in, and the one the campaign
/// collateral shows. One, not five: a policy page listing every synonym is a
/// policy page nobody reads.
export const SMS_OPT_IN_KEYWORD = 'JOIN'

/// What we ask them to reply to confirm.
export const SMS_CONFIRM_KEYWORD = 'YES'

export type SmsKeyword = 'stop' | 'start' | 'opt_in' | 'confirm' | 'help' | null

export function classifySmsKeyword(body: string): SmsKeyword {
  const normalized = body.trim().toUpperCase()
  if (STOP_KEYWORDS.has(normalized)) return 'stop'
  if (START_KEYWORDS.has(normalized)) return 'start'
  if (OPT_IN_KEYWORDS.has(normalized)) return 'opt_in'
  if (CONFIRM_KEYWORDS.has(normalized)) return 'confirm'
  if (HELP_KEYWORDS.has(normalized)) return 'help'
  return null
}
