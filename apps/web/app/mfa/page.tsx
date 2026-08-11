import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatSecretForDisplay } from '@storage/core/auth/totp'
import { AdminForm, Field } from '@/components/admin/form'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { requireStaffActor } from '@/lib/rbac/session'
import { mfaStatus, pendingEnrollment } from '@/lib/auth/mfa'
import {
  beginEnrollmentAction,
  confirmEnrollmentAction,
  regenerateRecoveryCodesAction,
} from './actions'

export const metadata: Metadata = { title: 'Two-factor authentication' }

// PRD 00 §7.1 (B-079). Staff enrolment lives at /mfa, OUTSIDE the admin
// layout, and that placement is load-bearing rather than tidy: the admin layout
// redirects unenrolled staff here, and a page inside that layout would redirect
// to itself forever. A server layout cannot read the pathname, so there is no
// "except this one route" escape hatch to write.

export default async function MfaPage() {
  let staffUserId: string
  try {
    staffUserId = (await requireStaffActor()).staffUserId
  } catch (error) {
    if (error instanceof ForbiddenError) redirect('/login?from=%2Fadmin')
    throw error
  }

  const [status, pending] = await Promise.all([
    mfaStatus(staffUserId),
    pendingEnrollment(staffUserId),
  ])

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold">Two-factor authentication</h1>

      {status.enrolled ? (
        <EnrolledPanel unusedRecoveryCodes={status.unusedRecoveryCodes} />
      ) : pending ? (
        <ConfirmPanel secret={pending.secret} uri={pending.uri} />
      ) : (
        <StartPanel />
      )}
    </main>
  )
}

function StartPanel() {
  return (
    <>
      <p className="text-sm text-pretty">
        Every staff account needs a second factor before it can reach the admin. You will need an
        authenticator app — Google Authenticator, 1Password, Authy or any other — on a phone you
        keep with you.
      </p>
      <AdminForm action={beginEnrollmentAction} label="Start two-factor setup">
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Start setup
        </button>
      </AdminForm>
    </>
  )
}

function ConfirmPanel({ secret, uri }: { secret: string; uri: string }) {
  return (
    <>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-pretty">
        <li>
          Open your authenticator app and choose to add an account by entering a key by hand.
        </li>
        <li>
          Enter this key:
          {/* Grouped in fours, and selectable. Somebody reading 32 unbroken
              characters off a screen into a phone will lose their place. */}
          <output className="border-input mt-2 block rounded-md border p-3 font-mono text-base tracking-wider break-all">
            {formatSecretForDisplay(secret)}
          </output>
          <span className="text-muted-foreground mt-2 block text-xs text-pretty">
            On a phone you can{' '}
            <a href={uri} className="underline underline-offset-4">
              open it in your authenticator app
            </a>{' '}
            instead of typing it.
          </span>
        </li>
        <li>Enter the 6-digit code it shows, to prove the setup worked.</li>
      </ol>

      <AdminForm
        action={confirmEnrollmentAction}
        label="Finish two-factor setup"
        className="flex flex-col gap-3"
      >
        <Field
          name="code"
          label="Code from your app"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Finish setup
        </button>
      </AdminForm>

      <p className="text-muted-foreground text-sm text-pretty">
        Nothing is switched on until a code checks out — if you cannot get one, nobody is locked out
        of anything.
      </p>
    </>
  )
}

function EnrolledPanel({ unusedRecoveryCodes }: { unusedRecoveryCodes: number }) {
  return (
    <>
      <p className="text-sm text-pretty">
        Two-factor authentication is on for this account. Your authenticator app will ask for a code
        each time you sign in.
      </p>

      <p
        className={`text-sm text-pretty ${unusedRecoveryCodes <= 2 ? 'font-medium text-red-700' : 'text-muted-foreground'}`}
      >
        {unusedRecoveryCodes === 0
          ? 'You have no recovery codes left. If you lose your phone now, an administrator will have to reset your second factor for you.'
          : `You have ${unusedRecoveryCodes} unused recovery code${unusedRecoveryCodes === 1 ? '' : 's'}.`}
      </p>

      <AdminForm action={regenerateRecoveryCodesAction} label="Issue new recovery codes">
        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
        >
          Issue new recovery codes
        </button>
      </AdminForm>

      <p className="text-muted-foreground text-sm text-pretty">
        Issuing new codes stops every existing one working, used or not.
      </p>

      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-4">
          Back to the admin
        </Link>
      </p>
    </>
  )
}
