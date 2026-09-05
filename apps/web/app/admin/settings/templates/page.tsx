import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { BROADCAST_EVENT } from '@storage/core/comms'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { fieldsForTemplate, previewTemplate, templatesFor } from '@/lib/admin/templates'
import { saveTemplateAction, testSendAction } from './actions'

export const metadata = { title: 'Message templates' }

// PRD 05 CN-16 (B-053). Editing what tenants are told, without a deploy.
//
// Saving is append-only — a new version, the previous one deactivated — because
// `Message` records the version it sent, and that is what lets a message from
// last Tuesday be shown exactly as it went out. Editing a row in place would
// quietly rewrite history that a lien file may depend on.

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>
}) {
  const { key } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above to edit its templates.
      </p>
    )
  }
  if (!hasPermissionAnywhere(actor, ['facility:settings'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to templates.</p>
  }

  const facilityId = selected.facility.id
  const templates = await templatesFor(actor, facilityId)
  const active = templates.find((template) => template.key === key) ?? templates[0]
  const fields = active ? fieldsForTemplate(active.key) : []
  const preview = active
    ? await previewTemplate(actor, facilityId, {
        key: active.key,
        subject: active.subject ?? '',
        bodyText: active.bodyText,
        requiredMergeFields: active.requiredMergeFields,
      })
    : null

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Message templates — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          What tenants are told, and when. Saving publishes a new version; older versions stay so a
          message already sent can still be shown exactly as it went out.
        </p>
      </div>

      <nav aria-label="Templates" className="flex flex-wrap gap-2">
        {templates.map((template) => (
          <Link
            key={template.key}
            href={`/admin/settings/templates?key=${template.key}`}
            aria-current={template.key === active?.key ? 'page' : undefined}
            className={
              template.key === active?.key
                // B-251. Same 1.09:1 selected state as the management pack's
                // month chips, on a screen the review did not name — found by
                // sweeping every `aria-current` in the app rather than only the
                // four sites the row listed. Same fix, same reasoning.
                ? 'border-foreground bg-accent rounded-md border-2 px-3 py-2 text-sm font-medium'
                : 'border-input hover:bg-accent rounded-md border-2 px-3 py-2 text-sm'
            }
          >
            {template.key}
            {template.isOverride && <span className="text-muted-foreground"> · overridden</span>}
          </Link>
        ))}
      </nav>

      {!active ? (
        <p className="text-muted-foreground text-sm">No templates are seeded yet.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <AdminForm action={saveTemplateAction} label={`Edit ${active.key}`} className="flex flex-col gap-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            <input type="hidden" name="key" value={active.key} />
            <input type="hidden" name="requiredMergeFields" value={active.requiredMergeFields.join(',')} />

            <p className="text-muted-foreground text-xs">
              Version {active.version}
              {active.isOverride ? ' · this facility’s own copy' : ' · the shared default'}
              {active.event === BROADCAST_EVENT
                ? ' · sent by hand from Announcements'
                : active.event
                  ? ` · sent on ${active.event}`
                  : ' · not wired to an event yet'}
            </p>

            <Field name="subject" label="Subject" defaultValue={active.subject ?? ''} />
            <label className="flex flex-col gap-1 text-sm">
              Message
              <textarea
                name="bodyText"
                rows={16}
                defaultValue={active.bodyText}
                className="border-input bg-background rounded-md border p-2 font-mono text-sm"
              />
            </label>

            <Field
              name="scope"
              label="Publish to"
              as="select"
              defaultValue={active.isOverride ? 'facility' : 'org'}
              hint="A facility copy overrides the shared default for this site only."
            >
              <option value="org">Every facility (the shared default)</option>
              <option value="facility">This facility only</option>
            </Field>

            <div className="flex flex-wrap gap-3">
              <Button type="submit">Publish new version</Button>
            </div>
          </AdminForm>

          <aside className="flex flex-col gap-4">
            <section aria-labelledby="fields-heading">
              <h2 id="fields-heading" className="text-sm font-medium">
                Fields you can use
              </h2>
              <p className="text-muted-foreground mt-1 text-xs text-pretty">
                Only these. Anything else has no value when the message is sent, so publishing is
                blocked rather than letting it fail silently at 2am.
              </p>
              <dl className="mt-2 flex flex-col gap-2 text-xs">
                {fields.map((field) => (
                  <div key={field.field}>
                    <dt className="font-mono">{`{{${field.field}}}`}</dt>
                    <dd className="text-muted-foreground">{field.description}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="preview-heading">
              <h2 id="preview-heading" className="text-sm font-medium">
                Preview
              </h2>
              {preview?.ok ? (
                <div className="border-input mt-2 rounded-lg border p-3 text-xs">
                  <p className="text-muted-foreground">From: {preview.from}</p>
                  {preview.replyTo && <p className="text-muted-foreground">Reply-to: {preview.replyTo}</p>}
                  <p className="mt-2 font-medium">{preview.subject}</p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.text}</pre>
                </div>
              ) : (
                <p role="alert" className="border-input mt-2 rounded-lg border p-3 text-xs text-pretty">
                  {preview?.problem}
                  {preview && preview.missing.length > 0 && ` Missing: ${preview.missing.join(', ')}.`}
                </p>
              )}
            </section>

            <AdminForm action={testSendAction} label="Send a test" className="flex flex-col gap-2">
              <input type="hidden" name="facilityId" value={facilityId} />
              <input type="hidden" name="key" value={active.key} />
              <input type="hidden" name="subject" value={active.subject ?? ''} />
              <input type="hidden" name="bodyText" value={active.bodyText} />
              <input type="hidden" name="requiredMergeFields" value={active.requiredMergeFields.join(',')} />
              <button
                type="submit"
                className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
              >
                Send a test to myself
              </button>
              <p className="text-muted-foreground text-xs text-pretty">
                Goes to your own signed-in address only — never a typed one.
              </p>
            </AdminForm>
          </aside>
        </div>
      )}
    </div>
  )
}
