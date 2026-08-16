import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatSecretForDisplay } from '@storage/core/auth/totp'
import { enrolmentQr } from '@/lib/auth/totp-qr'
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
  const qr = enrolmentQr(uri)
  return (
    <>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-pretty">
        <li>
          Open your authenticator app and add an account — by scanning the code below, or by
          entering the key by hand.
        </li>
        <li>
          {/* B-108. The QR and the typed key SIDE BY SIDE, and the key is not
              behind a toggle: the ordinary case is a key on a laptop screen
              and an authenticator in a pocket, which the pre-existing
              `otpauth://` link only helps with when the enrolling device IS
              the phone. */}
          <div className="mt-2 flex flex-wrap items-start gap-4">
            {/* `alt=""` — deliberately, and this is 1.1.1 Non-text Content,
                Level A rather than the AA the row originally claimed.
                
                The QR carries no information the adjacent key does not: it IS
                the key, in a form a camera can read. So the key is the text
                equivalent and the image is decorative. `alt="QR code"` would
                announce information it does not carry, and `alt={uri}` would
                put the shared secret into the accessibility tree, into AT logs
                and into extension dumps — the exact surface everything else
                here keeps it off. */}
            <div
              aria-hidden="true"
              className="border-input shrink-0 rounded-md border bg-white p-2"
              // Server-generated, inlined, never fetchable, never logged, and
              // gone when this render is. See lib/auth/totp-qr.ts.
              dangerouslySetInnerHTML={{ __html: qr.svg }}
            />
            <div className="min-w-0 flex-1">
              <span className="text-sm">Or enter this key:</span>
              {/* Grouped in fours, and selectable. Somebody reading 32 unbroken
                  characters off a screen into a phone will lose their place. */}
              <output className="border-input mt-2 block rounded-md border p-3 font-mono text-base tracking-wider break-all">
                <span aria-hidden="true">{formatSecretForDisplay(secret)}</span>
                {/* The grouped form is NOT an adequate equivalent by ear:
                    `formatSecretForDisplay` makes pronounceable four-character
                    blocks that VoiceOver reads as words, and I/1, O/0 and S/5
                    are indistinguishable spoken. Character-separated here, the
                    same treatment `gate-code-panel.tsx` gives a gate code —
                    without it the QR helps sighted staff and nobody else,
                    which inverts the reason for adding it. */}
                <span className="sr-only">{secret.split('').join(' ')}</span>
              </output>
              <span className="text-muted-foreground mt-2 block text-xs text-pretty">
                Setting this up on the phone itself? You can{' '}
                <a href={uri} className="underline underline-offset-4">
                  open it in your authenticator app
                </a>{' '}
                instead.
              </span>
            </div>
          </div>
        </li>
        <li>Enter the 6-digit code it shows, to prove the setup worked.</li>
      </ol>

      <AdminForm
        action={confirmEnrollmentAction}
        label="Finish two-factor setup"
        className="flex flex-col gap-3"
        // The codes come back on THIS form's success. Identical treatment on
        // regenerate below — the row asks for both, and the second is the one
        // somebody reaches deliberately, having already lost the first set.
        detailsAs="recovery-codes"
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

      <AdminForm
        action={regenerateRecoveryCodesAction}
        label="Issue new recovery codes"
        detailsAs="recovery-codes"
      >
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
