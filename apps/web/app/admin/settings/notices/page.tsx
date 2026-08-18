import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { exampleNoticeTemplate, noticeTemplatesFor } from '@/lib/admin/notice-templates'
import {
  NOTICE_DISCLAIMER,
  noticeTypeLabel,
  NOTICE_TYPES,
  REQUIRED_NOTICE_FIELDS,
} from '@storage/core/notices'
import { saveNoticeTemplateAction } from './actions'

export const metadata = { title: 'Notice templates' }

// PRD 02 §4.6 US-27 / US-29 (B-061). Where an operator and their attorney write
// the lien notice text this facility actually sends.
//
// The disclaimer is persistent and not dismissible, the same as B-056's
// timeline screen and for a stronger reason: this is the document itself.


function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

export default async function NoticeTemplatesPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['facility:settings'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to this.</p>
  }

  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — notice templates are per-site, because lien requirements are
        per-state.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const templates = await noticeTemplatesFor(actor, facilityId)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Notice templates — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          The text of the pre-lien and lien notices this facility generates.
        </p>
      </div>

      {/* US-29's guardrail. Persistent, not dismissible — the person approving a
          sale eight months from now is not the person reading this today. */}
      <p role="note" className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950 text-pretty">
        <strong className="block">Draft only — not legal advice.</strong>
        {NOTICE_DISCLAIMER}
      </p>

      {NOTICE_TYPES.map((type) => {
        const versions = templates.filter((one) => one.type === type)
        const active = versions.find((one) => one.active && one.facilityId === facilityId)
        const inherited = active
          ? undefined
          : versions.find((one) => one.active && one.facilityId === null)
        const starting = active ?? inherited ?? { ...exampleNoticeTemplate(type), version: 0 }

        return (
          <section key={type} aria-labelledby={`t-${type}`} className="flex flex-col gap-3">
            <h2 id={`t-${type}`} className="text-sm font-medium">
              {noticeTypeLabel(type)}
            </h2>

            <p className="text-muted-foreground text-sm">
              {active ? (
                <>
                  Version {active.version}, saved {formatDate(active.createdAt)}
                  {active.createdByName ? ` by ${active.createdByName}` : ''}
                  {active.noticeCount > 0 && ` · used by ${active.noticeCount} notice${active.noticeCount === 1 ? '' : 's'}`}
                </>
              ) : inherited ? (
                'Using the organisation default. Saving below creates this facility’s own version.'
              ) : (
                // The refusal that matters: no template means no notice, rather
                // than silently mailing an unedited draft.
                'Nothing saved yet. Until you save one, this facility cannot generate this notice.'
              )}
            </p>

            <form action={saveNoticeTemplateAction} className="border-input flex flex-col gap-3 rounded-lg border p-4">
              <input type="hidden" name="facilityId" value={facilityId} />
              <input type="hidden" name="type" value={type} />
              <label className="flex flex-col gap-1 text-sm">
                Document title
                <input
                  name="title"
                  required
                  defaultValue={starting.title}
                  className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Notice text
                <textarea
                  name="body"
                  required
                  rows={16}
                  defaultValue={starting.body}
                  className="border-input bg-background rounded-md border px-3 py-2 font-mono text-xs"
                />
              </label>
              <div className="text-muted-foreground text-xs">
                <p className="font-medium">Every notice must include all of these merge fields:</p>
                <p className="mt-1 font-mono text-pretty">
                  {REQUIRED_NOTICE_FIELDS.map((field) => `{{${field}}}`).join('  ')}
                </p>
                <p className="mt-1 text-pretty">
                  Saving fails if any is missing — a notice with a blank where the deadline should be
                  is a legal document with a hole in it.
                </p>
              </div>
              <button
                type="submit"
                className="border-input hover:bg-accent min-h-11 self-start rounded-md border px-4 text-sm font-medium"
              >
                Save as version {(active?.version ?? 0) + 1}
              </button>
            </form>
          </section>
        )
      })}
    </div>
  )
}
