import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sign in' }

// Placeholder redirect target for role-gated routes. The real sign-in screen
// (email/password, magic link) is B-033 — the auth endpoints it calls
// already work as of B-003.
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-muted-foreground text-sm">
        The sign-in screen is built in backlog item B-033.
      </p>
    </main>
  )
}
