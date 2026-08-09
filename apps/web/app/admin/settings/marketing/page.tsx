import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { marketingProfile } from '@/lib/admin/marketing-profile'
import { publicFacilityBySlug } from '@/lib/facility/public-facility'
import { siteOrigin } from '@/lib/marketing/origin'
import { facilityPagePath } from '@/lib/marketing/paths'
import {
  absoluteUrl,
  addressLines,
  DESCRIPTION_IDEAL_MAX,
  formatPhone,
  GBP_CHECKLIST,
  gbpWebsiteUrl,
  TITLE_IDEAL_MAX,
} from '@storage/core/marketing'
import {
  addFaqAction,
  addPhotoAction,
  removeFaqAction,
  removePhotoAction,
  saveCopyAction,
  saveGbpAction,
} from './actions'

export const metadata = { title: 'Marketing profile' }

// PRD 04 US-2, US-5 (B-067). The unique content blocks of a location page,
// editable without a deploy.
//
// Every field falls back to B-066's generated default when left empty, and the
// form says so — so "clear it" is a real option rather than a way to publish an
// empty title.

const PHOTO_KINDS = [
  ['exterior', 'Exterior — the front of the site from the road'],
  ['gate', 'Gate or entrance'],
  ['hallway', 'Hallway or interior corridor'],
  ['unit', 'A sample unit, door open'],
  ['security', 'A security feature — cameras, lighting, fencing'],
  ['other', 'Something else'],
] as const

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(value)
}

export default async function MarketingProfilePage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above — a marketing profile belongs to one location.
      </p>
    )
  }
  if (!hasPermissionAnywhere(actor, ['facility:settings'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to this.</p>
  }

  const facilityId = selected.facility.id
  const publicFacility = await publicFacilityBySlug(selected.facility.slug)

  // US-5 AC3: "the location page's rendered NAP is byte-identical to the
  // facility record so staff can copy-paste into GBP." Built from the same
  // formatter the page and the JSON-LD use (FR-SEO-7), so what is copied here
  // is exactly what is published.
  const napBlock = publicFacility
    ? [publicFacility.name, ...addressLines(publicFacility), formatPhone(publicFacility.phone) ?? '']
        .filter(Boolean)
        .join('\n')
    : selected.facility.name

  const path = publicFacility ? facilityPagePath(publicFacility) : null
  const publicUrl = path ? absoluteUrl(siteOrigin(), path) : ''

  const profile = await marketingProfile(actor, facilityId, publicUrl, napBlock)
  const outstanding = profile.readiness.filter((check) => !check.ok)

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Marketing profile — {profile.facilityName}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          The content that makes this location&apos;s page its own page rather than a template with
          the city swapped. Everything here is optional — left empty, the page uses a generated
          default that is true but reads the same as every other facility&apos;s.
          {path && (
            <>
              {' '}
              <Link href={path} className="underline underline-offset-2">
                See the live page
              </Link>
              .
            </>
          )}
        </p>
      </div>

      {/* The launch gate, reported rather than enforced. Blocking a facility
          from going active over a missing photo would take a rentable unit off
          sale to fix a marketing problem. */}
      <section aria-labelledby="readiness" className="flex flex-col gap-3">
        <h2 id="readiness" className="font-medium">
          {outstanding.length === 0
            ? 'This page is ready'
            : `${outstanding.length} thing${outstanding.length === 1 ? '' : 's'} left`}
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.readiness.map((check) => (
            <li
              key={check.key}
              className={
                check.ok
                  ? 'border-input rounded-lg border p-3 text-sm'
                  : 'rounded-lg border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950'
              }
            >
              {/* Never colour alone (WCAG 1.4.1): the word says which it is. */}
              <span className="font-medium">
                {check.ok ? 'Done' : 'To do'} — {check.label}
              </span>
              {!check.ok && check.fix && <p className="mt-1 text-pretty">{check.fix}</p>}
            </li>
          ))}
        </ul>
      </section>

      <AdminForm action={saveCopyAction} label="Page copy" className="flex flex-col gap-4">
        <h2 className="font-medium">Page copy</h2>
        <input type="hidden" name="facilityId" value={facilityId} />

        <Field
          name="seoTitle"
          label="SEO title"
          defaultValue={profile.seoTitle ?? ''}
          hint={`About ${TITLE_IDEAL_MAX} characters is what a search result shows. Empty uses the generated title.`}
        />
        <label className="flex flex-col gap-1 text-sm">
          Meta description
          <textarea
            name="metaDescription"
            rows={3}
            defaultValue={profile.metaDescription ?? ''}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
          <span className="text-muted-foreground text-xs text-pretty">
            About {DESCRIPTION_IDEAL_MAX} characters. Empty uses the generated description.
          </span>
        </label>

        {/* US-2 AC3's duplicate warning. Shown against the SAVED description
            rather than live as you type — a warning that flickers while
            somebody edits is one they stop reading. */}
        {profile.duplicates.length > 0 && (
          <p role="alert" className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
            <span className="font-semibold">This description is nearly identical to another.</span>
            <span className="mt-1 block text-pretty">
              {profile.duplicates
                .map((match) => `${match.facilityName} (${Math.round(match.similarity * 100)}%)`)
                .join(', ')}
              . Two pages saying the same thing compete with each other instead of ranking
              separately — the fix is a sentence about what is actually different here.
            </span>
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Hero copy
          <textarea
            name="heroCopy"
            rows={2}
            defaultValue={profile.heroCopy ?? ''}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
          <span className="text-muted-foreground text-xs">
            One or two sentences under the facility name.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Long description
          <textarea
            name="longDescription"
            rows={10}
            defaultValue={profile.longDescription ?? ''}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
          <span className="text-muted-foreground text-xs text-pretty">
            A blank line starts a new paragraph. This is the biggest single lever on whether this
            page ranks on its own rather than as one of a set.
          </span>
        </label>

        <Button type="submit" className="self-start">
          Save copy
        </Button>
      </AdminForm>

      <section aria-labelledby="photos-heading" className="flex flex-col gap-3">
        <h2 id="photos-heading" className="font-medium">
          Photos
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          There is no file upload yet, so paste the address of an image that is already online.
          Alt text is required — a screen reader reads it, and so does image search.
        </p>

        <ul className="flex flex-col gap-2">
          {profile.photos.map((photo) => (
            <li
              key={photo.id}
              className="border-input flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground text-xs uppercase">{photo.kind}</span>
                <span className="block truncate font-medium">{photo.alt}</span>
                <span className="text-muted-foreground block truncate text-xs">{photo.url}</span>
              </span>
              <form action={removePhotoAction}>
                <input type="hidden" name="facilityId" value={facilityId} />
                <input type="hidden" name="photoId" value={photo.id} />
                <Button type="submit" variant="outline">
                  Remove
                </Button>
              </form>
            </li>
          ))}
          {profile.photos.length === 0 && (
            <li className="text-muted-foreground text-sm">No photos yet.</li>
          )}
        </ul>

        <AdminForm action={addPhotoAction} label="Add a photo" className="border-input flex flex-col gap-3 rounded-lg border p-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field name="url" label="Image address" placeholder="https://…" />
          <Field name="alt" label="What the photo shows" hint="“The front gate with the keypad on the left.”" />
          <Field name="kind" label="Kind" as="select" defaultValue="exterior">
            {PHOTO_KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Field>
          <Button type="submit" className="self-start">
            Add photo
          </Button>
        </AdminForm>
      </section>

      <section aria-labelledby="faq-heading" className="flex flex-col gap-3">
        <h2 id="faq-heading" className="font-medium">
          Questions and answers
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          With none written, the page shows five generated answers about hours, contracts and
          sizes. Writing even one replaces the whole set — so write the ones a renter actually asks
          at this site.
        </p>

        <ul className="flex flex-col gap-2">
          {profile.faqs.map((faq) => (
            <li key={faq.id} className="border-input flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <p className="font-medium">{faq.question}</p>
              <p className="text-muted-foreground text-pretty">{faq.answer}</p>
              <form action={removeFaqAction} className="self-start">
                <input type="hidden" name="facilityId" value={facilityId} />
                <input type="hidden" name="faqId" value={faq.id} />
                <Button type="submit" variant="outline">
                  Remove
                </Button>
              </form>
            </li>
          ))}
          {profile.faqs.length === 0 && (
            <li className="text-muted-foreground text-sm">
              None yet — the generated five are showing.
            </li>
          )}
        </ul>

        <AdminForm action={addFaqAction} label="Add a question" className="border-input flex flex-col gap-3 rounded-lg border p-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field name="question" label="Question" />
          <label className="flex flex-col gap-1 text-sm">
            Answer
            <textarea
              name="answer"
              rows={3}
              className="border-input bg-background rounded-md border p-2 text-sm"
            />
          </label>
          <Button type="submit" className="self-start">
            Add question
          </Button>
        </AdminForm>
      </section>

      <section aria-labelledby="gbp-heading" className="flex flex-col gap-3">
        <h2 id="gbp-heading" className="font-medium">
          Google Business Profile
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          This system does not write to Google. The checklist is something a person confirms, and
          the date is the point — an unchecked profile drifts out of step with this record and
          nobody notices until the local pack does.
        </p>

        {profile.gbp.stale && (
          <p role="alert" className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
            {profile.gbp.verifiedAt
              ? `Last checked ${formatDate(profile.gbp.verifiedAt)} — more than 90 days ago.`
              : 'Never checked.'}
          </p>
        )}

        <div className="border-input rounded-lg border p-4 text-sm">
          <h3 className="font-medium">Copy this into Google, exactly</h3>
          <p className="text-muted-foreground mt-1 text-xs text-pretty">
            Byte-identical to what the live page renders. Retyping it is how a stray “Ste” for
            “Suite” splits the citation.
          </p>
          <pre className="bg-muted mt-2 rounded-md p-3 text-xs whitespace-pre-wrap">
            {profile.gbp.napBlock}
          </pre>
          {publicUrl && (
            <>
              <p className="mt-3 font-medium">Website link, with tracking</p>
              <pre className="bg-muted mt-1 rounded-md p-3 text-xs break-all whitespace-pre-wrap">
                {gbpWebsiteUrl(publicUrl)}
              </pre>
            </>
          )}
        </div>

        <AdminForm action={saveGbpAction} label="GBP checklist" className="flex flex-col gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          {GBP_CHECKLIST.map((item) => (
            <label key={item.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="gbp"
                value={item.key}
                defaultChecked={profile.gbp.checked.includes(item.key)}
                className="mt-1 size-4"
              />
              <span className="text-pretty">{item.label}</span>
            </label>
          ))}
          <Button type="submit" className="self-start">
            Save and date it today
          </Button>
        </AdminForm>
      </section>
    </div>
  )
}
