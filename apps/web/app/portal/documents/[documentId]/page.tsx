import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { portalDocument } from '@/lib/portal/documents'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export const metadata: Metadata = {
  title: 'Document',
  robots: { index: false, follow: false },
}

// PRD 01 US-705. Generated documents are HTML (B-023's decision — the
// canonical form is the thing whose hash was signed, and that is markup, not
// a rendered PDF).
//
// The content is rendered with dangerouslySetInnerHTML, which is safe here
// for a specific reason and not a general licence: this markup is produced by
// lib/documents/render.ts from templates in this repo, and its hash is the
// evidence that it has not changed since signing. It is never user-supplied.
// Anything that ever stores tenant-authored HTML in this table has to
// sanitise before it reaches this component.

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>
}) {
  const { documentId } = await params
  const actor = await requireTenantActor()
  const document = await portalDocument(actor.tenantId, documentId)
  const dict = dictionaryFor(await getLocale())
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  if (!document) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t('doc.title')}</h1>
        <p className="text-sm text-pretty">{t('doc.notFound')}</p>
        <Link href="/portal/documents" className="text-sm underline underline-offset-4">
          {t('doc.backToDocuments')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{document.title}</h1>
      <article
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: document.content }}
      />
      <Link href="/portal/documents" className="text-sm underline underline-offset-4">
        {t('doc.backToDocuments')}
      </Link>
    </div>
  )
}
