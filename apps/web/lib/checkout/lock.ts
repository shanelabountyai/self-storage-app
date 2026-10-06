/// FR-4.1's "30-min unit lock".
///
/// In a file of its own, importing nothing: `lib/http/rate-limit.ts` sizes its
/// window from it, and `lib/auth/flows.ts` imports the limiter. Read from
/// `session.ts`, that closed an import cycle (session → comms → auth flows →
/// limiter → session) and the window was `NaN`, or a build-time "Cannot access
/// before initialization", whenever the session module happened to load first.
export const LOCK_MINUTES = 30
