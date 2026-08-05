import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { resetPasswordAction } from './actions'

export const metadata: Metadata = { title: 'Set a new password' }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">This link isn&apos;t good any more</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Password reset links stop working once they expire or are used. Nothing has changed on
          your account.
        </p>
        <p className="text-sm">
          <Link href="/forgot-password" className="underline underline-offset-4">
            Send a new link
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">Set a new password</h1>

      <AdminForm action={resetPasswordAction} label="Set a new password" className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <Field
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters."
          className="flex flex-col gap-1 text-sm"
        />
        <Field
          name="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Set new password
        </button>
      </AdminForm>

      <p className="text-sm">
        <Link href="/login" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </main>
  )
}
