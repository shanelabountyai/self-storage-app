// PRD 05 CN-14 (B-074). The exact carrier-standard keyword sets the AC names.
// Matched the same way Twilio's own Advanced Opt-Out does: the WHOLE message
// body, trimmed and case-insensitive — "please stop" is not a STOP, the same
// way it is not one to a carrier's own filter.

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])

/// START and UNSTOP are the carrier-standard RESUME keywords, and they take
/// effect immediately — carriers require that, and a person who already opted
/// in once and then stopped is not somebody to ask twice.
const START_KEYWORDS = new Set(['START', 'UNSTOP'])

/// The keywords that BEGIN an opt-in. Deliberately separate from the resume
/// set: these start a double opt-in and do not subscribe anybody on their own.
const OPT_IN_KEYWORDS = new Set(['JOIN', 'SUBSCRIBE'])

/// The reply that completes it. On its own — with nothing pending — it means
/// nothing, which is what makes the two-step real rather than decorative.
const CONFIRM_KEYWORDS = new Set(['YES', 'Y'])

const HELP_KEYWORDS = new Set(['HELP'])

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
