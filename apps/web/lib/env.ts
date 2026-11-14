import { z } from 'zod'

// K11 / INV-14. Every environment variable the app reads, validated once at
// boot by `instrumentation.ts`. `.env.example` must name every key here (and
// tests/env-schema.test.ts holds both lists to the code).
//
// Deliberately permissive where the code already degrades on its own: an unset
// Stripe, Resend, Twilio, Lob or Search Console key is a supported state with a
// stated fallback, and `MARKETPLACE_LEAD_KEYS` is parsed (and refused closed)
// by its own reader. What this adds is a loud, named failure at boot for the
// two the app cannot run without, and for values whose shape is checkable.
const optional = z.string().min(1).optional()
const optionalUrl = z.string().url().optional()

export const envSchema = z.object({
  // Required everywhere the app runs.
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),

  // Platform / runtime, set by Node, Next, Vercel or CI; never set by hand.
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  NEXT_RUNTIME: z.enum(['nodejs', 'edge']).optional(),
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  VERCEL_PROJECT_PRODUCTION_URL: optional,
  CI: optional,

  // Database
  DIRECT_URL: optional,
  EXPECTED_DEV_DB_HOST: optional,
  TEST_DB_SCHEMA: optional,

  // Auth and site origin
  AUTH_URL: optionalUrl,
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  DEMO_ACCESS_PASSWORD: optional,

  // Jobs and webhooks (each refuses closed when unset)
  CRON_SECRET: optional,
  STRIPE_SECRET_KEY: optional,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  HARDWARE_WEBHOOK_SECRET: optional,
  MARKETPLACE_LEAD_KEYS: optional,

  // Communications
  RESEND_API_KEY: optional,
  RESEND_WEBHOOK_SECRET: optional,
  COMMS_EMAIL_DOMAIN: optional,
  COMMS_KILL_SWITCH: optional,
  COMMS_SANDBOX_INBOX: optional,
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  COMMS_SANDBOX_SMS: optional,
  CERTIFIED_MAIL_API_KEY: optional,

  // At-rest encryption. Its shape (32 bytes as hex) is checked by its reader,
  // lib/access/secret.ts, which degrades to "no code can be shown" rather than
  // failing the boot; that posture is kept.
  ACCESS_CODE_ENCRYPTION_KEY: optional,

  // Storage, maps, search
  BLOB_READ_WRITE_TOKEN: optional,
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: optional,
  NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: optional,
  GOOGLE_SITE_VERIFICATION: optional,
  GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL: optional,
  GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY: optional,
  GOOGLE_SEARCH_CONSOLE_SITE_URL: optional,
  INDEXNOW_KEY: optional,

  // Test-only switch for the error page on a production build.
  E2E_FORCE_ERROR: optional,
})

export type Env = z.infer<typeof envSchema>

/// Validates the environment and throws naming the bad keys, never their
/// values. An empty `NAME=` line is unset, not an invalid empty string.
export function parseEnv(source: Record<string, string | undefined>): Env {
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ''))
  const result = envSchema.safeParse(present)
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')
    throw new Error(`Invalid environment: ${keys}`)
  }
  return result.data
}
