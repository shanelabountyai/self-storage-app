// PRD 05 CN-14 (B-074). The exact carrier-standard keyword sets the AC names.
// Matched the same way Twilio's own Advanced Opt-Out does: the WHOLE message
// body, trimmed and case-insensitive — "please stop" is not a STOP, the same
// way it is not one to a carrier's own filter.

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
const START_KEYWORDS = new Set(['START', 'UNSTOP'])
const HELP_KEYWORDS = new Set(['HELP'])

export type SmsKeyword = 'stop' | 'start' | 'help' | null

export function classifySmsKeyword(body: string): SmsKeyword {
  const normalized = body.trim().toUpperCase()
  if (STOP_KEYWORDS.has(normalized)) return 'stop'
  if (START_KEYWORDS.has(normalized)) return 'start'
  if (HELP_KEYWORDS.has(normalized)) return 'help'
  return null
}
