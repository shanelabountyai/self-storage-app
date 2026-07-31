import type { Metadata } from 'next'

/// Shared frame for the static/legal pages (PRD 01 FR-8.1). One component so
/// heading order, measure, and the draft notice can't drift between them.
export function ProsePage({
  title,
  intro,
  draftNotice,
  children,
}: {
  title: string
  intro?: string
  /// Rendered for anything with legal weight. Every legal artifact in this
  /// project is an unreviewed draft (D-10) and must say so where a reader
  /// will actually see it — not in a code comment.
  draftNotice?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
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
