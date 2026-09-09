import { Fragment } from 'react'
import type { MessageSegment } from '@/lib/i18n'

// B-272. The runs of a sentence, with the ones in another language marked.
//
// B-269 marked an operator's own promotion terms `lang="en"` where they stand
// alone, and left three surfaces that could not: they took the terms as a
// plain string, so the marking was thrown away the moment the words were
// interpolated into a Spanish sentence. `translateSegments` keeps it; this is
// what renders it.
//
// Its own file, and deliberately not exported from `lib/promotions/terms.tsx`
// where the first version of it lived: `components/admin/form.tsx` is a client
// component every admin screen loads, and importing it from there would pull
// `@storage/core/promotions` and the money formatters into all of their
// bundles for a `<span>`.
//
// A `Fragment` rather than a `<span>` for an unmarked run, so a sentence with
// nothing to mark produces exactly the text node it did before this existed.
export function MessageSegments({ segments }: { segments: readonly MessageSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.lang ? (
          <span key={index} lang={segment.lang}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}
