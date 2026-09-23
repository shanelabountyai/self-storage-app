import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatSecretForDisplay } from '@storage/core/auth/totp'
import { enrolmentQr } from '@/lib/auth/totp-qr'
import { AdminForm, Field } from '@/components/admin/form'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { requireStaffActor } from '@/lib/rbac/session'
import { mfaStatus, pendingEnrollment } from '@/lib/auth/mfa'
import { dictionaryFor, plural, translate, type Dictionary } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import {
  beginEnrollmentAction,
  confirmEnrollmentAction,
  regenerateRecoveryCodesAction,
} from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'mfa.title') }
}

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
  const dict = dictionaryFor(await getLocale())
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold">{t('mfa.title')}</h1>

      {status.enrolled ? (
        <EnrolledPanel unusedRecoveryCodes={status.unusedRecoveryCodes} dict={dict} />
      ) : pending ? (
        <ConfirmPanel secret={pending.secret} uri={pending.uri} dict={dict} />
      ) : (
        <StartPanel dict={dict} />
      )}
    </div>
  )
}

function StartPanel({ dict }: { dict: Dictionary }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)
  return (
    <>
      <p className="text-sm text-pretty">{t('mfa.start.body')}</p>
      <AdminForm action={beginEnrollmentAction} label={t('mfa.start.formLabel')}>
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          {t('mfa.start.submit')}
        </button>
      </AdminForm>
    </>
  )
}

function ConfirmPanel({ secret, uri, dict }: { secret: string; uri: string; dict: Dictionary }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)
  const qr = enrolmentQr(uri)
  return (
    <>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-pretty">
        <li>{t('mfa.confirm.step1')}</li>
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
              <span className="text-sm">{t('mfa.confirm.orEnterKey')}</span>
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
                {t('mfa.confirm.phoneLead')}{' '}
                <a href={uri} className="underline underline-offset-4">
                  {t('mfa.confirm.phoneLink')}
                </a>{' '}
                {t('mfa.confirm.phoneTail')}
              </span>
            </div>
          </div>
        </li>
        <li>{t('mfa.confirm.step3')}</li>
      </ol>

      <AdminForm
        action={confirmEnrollmentAction}
        label={t('mfa.confirm.formLabel')}
        className="flex flex-col gap-3"
        // The codes come back on THIS form's success. Identical treatment on
        // regenerate below — the row asks for both, and the second is the one
        // somebody reaches deliberately, having already lost the first set.
        detailsAs="recovery-codes"
      >
        <Field
          name="code"
          label={t('mfa.confirm.codeLabel')}
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
          {t('mfa.confirm.submit')}
        </button>
      </AdminForm>

      <p className="text-muted-foreground text-sm text-pretty">{t('mfa.confirm.reassurance')}</p>
    </>
  )
}

function EnrolledPanel({ unusedRecoveryCodes, dict }: { unusedRecoveryCodes: number; dict: Dictionary }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)
  return (
    <>
      <p className="text-sm text-pretty">{t('mfa.enrolled.body')}</p>

      <p
        className={`text-sm text-pretty ${unusedRecoveryCodes <= 2 ? 'font-medium text-danger-fg' : 'text-muted-foreground'}`}
      >
        {unusedRecoveryCodes === 0
          ? t('mfa.enrolled.noneLeft')
          : plural(dict, unusedRecoveryCodes, 'mfa.enrolled.remainingOne', 'mfa.enrolled.remainingOther')}
      </p>

      <AdminForm
        action={regenerateRecoveryCodesAction}
        label={t('mfa.enrolled.formLabel')}
        detailsAs="recovery-codes"
      >
        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
        >
          {t('mfa.enrolled.submit')}
        </button>
      </AdminForm>

      <p className="text-muted-foreground text-sm text-pretty">{t('mfa.enrolled.warning')}</p>

      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-4">
          {t('mfa.enrolled.backToAdmin')}
        </Link>
      </p>
    </>
  )
}
