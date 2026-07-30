// Before/after values are captured verbatim from entity rows, which means a
// careless caller could push a password hash or a gate code into a log that is
// retained for seven years and never deletable. Redaction happens here rather
// than at each call site, because the safe default has to be the automatic one.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export const REDACTED = '[redacted]'

/// Matched case-insensitively against key names, as substrings — `passwordHash`
/// and `newPassword` both hit `password`. `valueRef` is the gate-code reference
/// (PRD 03 SR-2: viewing a real code is a separate, audited permission).
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'valueref',
  'ssn',
  'taxid',
  'cardnumber',
  'cvv',
  'pin',
]

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
  return SENSITIVE_KEY_PATTERNS.some((pattern) =>
    normalized.includes(pattern.replace(/[^a-z]/g, '')),
  )
}

function walk(value: unknown, redactKeys: boolean, seen: WeakSet<object>): Json {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => walk(item, redactKeys, seen))

  if (typeof value === 'object') {
    // Cycles would otherwise recurse forever; an audit write must never hang.
    if (seen.has(value)) return REDACTED
    seen.add(value)

    const output: { [key: string]: Json } = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] =
        redactKeys && isSensitiveKey(key) ? REDACTED : walk(item, redactKeys, seen)
    }
    return output
  }

  // Functions and symbols have no place in an audit record.
  return null
}

/// JSON-safe conversion with no redaction. Internal to diffing — a normalised
/// value may still hold a credential, so it must never be persisted directly.
function normalize(value: unknown): Json {
  return walk(value, false, new WeakSet<object>())
}

/// Deep-redacts sensitive keys anywhere in the structure. Non-plain values
/// (Date, bigint, undefined) are normalised so the result is JSON-safe.
export function redact(value: unknown): Json {
  return walk(value, true, new WeakSet<object>())
}

export type Diff = {
  before: { [key: string]: Json }
  after: { [key: string]: Json }
}

/// Reduces a pair of entity snapshots to only what changed. Keeping whole rows
/// would bloat the log and drag in fields nobody edited — US-38 asks for
/// "before/after values (for edits)", not full copies.
export function diffSnapshots(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  options: { ignoreKeys?: readonly string[] } = {},
): Diff {
  // Churn columns that change on every write and say nothing about intent.
  const ignore = new Set([...(options.ignoreKeys ?? []), 'updatedAt', 'version'])

  // Comparison runs on raw values and redaction is applied to the result.
  // Redacting first would make two different passwords look identical, so a
  // credential rotation would vanish from the log entirely.
  const beforeRaw = (normalize(before ?? {}) ?? {}) as { [key: string]: Json }
  const afterRaw = (normalize(after ?? {}) ?? {}) as { [key: string]: Json }

  const changedBefore: { [key: string]: Json } = {}
  const changedAfter: { [key: string]: Json } = {}

  for (const key of new Set([...Object.keys(beforeRaw), ...Object.keys(afterRaw)])) {
    if (ignore.has(key)) continue
    const a = beforeRaw[key] ?? null
    const b = afterRaw[key] ?? null
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    // The key records that the field changed; redact() withholds the values.
    changedBefore[key] = redact({ [key]: a })![key as never] as Json
    changedAfter[key] = redact({ [key]: b })![key as never] as Json
  }

  return { before: changedBefore, after: changedAfter }
}
