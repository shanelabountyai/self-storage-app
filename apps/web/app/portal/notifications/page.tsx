import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm } from '@/components/admin/form'
import { requireTenantActor } from '@/lib/rbac/session'
import { currentPreferences, NOTIFICATION_CATEGORIES, smsConsentView } from '@/lib/portal/notifications'
import { revokeSmsAction, setPreferencesAction } from './actions'

export const metadata: Metadata = { title: 'Notification preferences' }

// PRD 05 CN-13 (B-074). "As Tara, I control my channels in the portal."
//
// Three categories, two channels — the exact grid the AC names. Legally
// significant mail (delinquency stages, lien supplements, rate increases) is
// deliberately NOT here: it is email-mandatory and cannot be toggled off, so
// it is described rather than offered as a control (AC's own instruction —
// "the UI says so").

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default async function NotificationsPage() {
  const actor = await requireTenantActor()
  const [grid, consent] = await Promise.all([
    currentPreferences(actor.tenantId),
    smsConsentView(actor.tenantId),
  ])

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Notification preferences</h1>

      <section aria-labelledby="grid-heading" className="flex flex-col gap-3">
        <h2 id="grid-heading" className="font-medium">
          What we send, and how
        </h2>
        <AdminForm action={setPreferencesAction} label="Notification preferences" className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-md border-collapse text-sm">
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">Category</th>
                  <th scope="col" className="py-2 pr-4">Email</th>
                  <th scope="col" className="py-2 pr-4">Text</th>
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_CATEGORIES.map((category) => (
                  <tr key={category.key} className="border-input border-b">
                    <th scope="row" className="py-3 pr-4 text-left font-normal align-top">
                      <span className="font-medium">{category.label}</span>
                      <p className="text-muted-foreground text-xs text-pretty">{category.description}</p>
                    </th>
                    <td className="py-3 pr-4 align-top">
                      <input
                        type="checkbox"
                        name={`${category.key}:email`}
                        value="yes"
                        defaultChecked={grid[category.key].email}
                        aria-label={`${category.label} by email`}
                      />
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <input
                        type="checkbox"
                        name={`${category.key}:sms`}
                        value="yes"
                        defaultChecked={grid[category.key].sms}
                        aria-label={`${category.label} by text`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="submit"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
          >
            Save preferences
          </button>
        </AdminForm>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Payment reminders, receipts and account notices only — not everything we send. Delinquency
          notices, lien-related mail and rate-increase notices always go by email; that is a legal
          requirement, not a setting, and there is no control for it here.
        </p>
      </section>

      <section aria-labelledby="sms-consent-heading" className="flex flex-col gap-3">
        <h2 id="sms-consent-heading" className="font-medium">
          Text message consent
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          What we send, when we send it and how to stop it is set out in our{' '}
          <Link href="/messaging-policy" className="underline underline-offset-4">
            text message policy
          </Link>
          .
        </p>
        {consent.state ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>{consent.state === 'granted' ? 'Granted — texts are on' : 'Revoked — texts are off'}</dd>
            {consent.capturedAt && (
              <>
                <dt className="text-muted-foreground">As of</dt>
                <dd>{formatWhen(consent.capturedAt)}</dd>
              </>
            )}
            {consent.source && (
              <>
                <dt className="text-muted-foreground">Recorded from</dt>
                <dd>{consent.source.replace(/_/g, ' ')}</dd>
              </>
            )}
            {consent.disclosureVersion && (
              <>
                <dt className="text-muted-foreground">Disclosure version</dt>
                <dd>{consent.disclosureVersion}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            We have never asked you about text messages, so none are sent.
          </p>
        )}

        {consent.state === 'granted' && (
          <AdminForm action={revokeSmsAction} label="Turn off text messages" className="flex flex-col gap-2">
            <p className="text-muted-foreground max-w-prose text-xs text-pretty">
              This has the same effect as replying STOP to a text from us: every SMS to this number
              stops, including account and payment texts, immediately.
            </p>
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
            >
              Turn off text messages
            </button>
          </AdminForm>
        )}
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  )
}
