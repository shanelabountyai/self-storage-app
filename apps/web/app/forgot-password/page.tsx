import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { requestPasswordResetAction } from './actions'

export const metadata: Metadata = { title: 'Forgot your password?' }

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">Forgot your password?</h1>
      <p className="text-muted-foreground text-sm text-pretty">
        Enter the email on your account and we will send you a link to set a new one.
      </p>

      <AdminForm
        action={requestPasswordResetAction}
        label="Request a password reset"
        className="flex flex-col gap-3"
      >
        {from && <input type="hidden" name="from" value={from} />}
        <Field
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Send reset link
        </button>
      </AdminForm>

      <p className="text-sm">
        <Link href={`/login${from ? `?from=${encodeURIComponent(from)}` : ''}`} className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </main>
  )
}
