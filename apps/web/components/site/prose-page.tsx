import type { Metadata } from 'next'
import type { Locale } from '@/lib/i18n'

/// Shared frame for the static/legal pages (PRD 01 FR-8.1). One component so
/// heading order, measure, and the draft notice can't drift between them.
export function ProsePage({
  title,
  intro,
  lang,
  draftNotice,
  children,
}: {
  title: string
  intro?: string
  /// B-269. The language of the words below, declared on the words rather than
  /// inferred from the shell around them — WCAG 2.1 SC 3.1.2 Language of Parts
  /// (AA).
  ///
  /// **Required on purpose, and that is the half of this item that lasts.**
  /// D-122 puts the locale in a cookie and the root layout sets `<html lang>`
  /// from it, so a visitor who has switched to Spanish gets `<html lang="es">`
  /// on every route — including the two legal pages D-123 and D-124
  /// deliberately keep in English. English contract prose inside a Spanish
  /// document is read aloud with Spanish phonemes, and it shipped that way
  /// past B-090f, B-260 and B-262 because nothing in the markup said which
  /// language the prose was in. An optional prop would have gone on being
  /// omitted; a required one makes the next prose page state its language or
  /// fail `npm run typecheck` in the fast CI lane.
  ///
  /// A translated caller passes `lang={locale}` — the same value as the shell,
  /// which is a no-op in the accessibility tree and is the point: the prop
  /// records that somebody decided, rather than that nobody looked.
  lang: Locale
  /// Rendered for anything with legal weight. Every legal artifact in this
  /// project is an unreviewed draft (D-10) and must say so where a reader
  /// will actually see it — not in a code comment.
  ///
  /// The notice itself is English literal text, so it inherits `lang` above.
  /// Every page that sets it is an English page today; a translated page that
  /// wanted one would have to translate this too, which is why the two live in
  /// the same component rather than in the caller.
  draftNotice?: boolean
  children: React.ReactNode
}) {
  return (
    <div lang={lang} className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {intro && <p className="text-muted-foreground mt-3 text-lg text-pretty">{intro}</p>}

      {draftNotice && (
        <div
          role="note"
          className="mt-6 rounded-md border border-yellow-500/50 bg-yellow-50 p-4 text-sm dark:bg-yellow-950/40"
        >
          <p className="font-medium">This is an unreviewed draft, not legal advice.</p>
          <p className="mt-1">
            This project is a learning exercise. Nothing here has been reviewed by a
            lawyer, and it does not create any agreement. Real terms would be drafted
            for the states a facility actually operates in.
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-6 text-pretty">{children}</div>
    </div>
  )
}

export function metadataFor(title: string, description: string): Metadata {
  return { title, description }
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-medium tracking-tight">{heading}</h2>
      {children}
    </section>
  )
}
