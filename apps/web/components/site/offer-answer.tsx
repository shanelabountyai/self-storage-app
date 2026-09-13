'use client'

// B-299 / SC 2.4.3. One of the two answers to the Spanish offer (B-290).
//
// Either answer sets `st_locale`, which ends the offer — so the button that was
// just pressed leaves the DOM and focus falls to `<body>`, putting a keyboard
// user back at the top of the document with their next Tab starting from the
// site header. The consent banner has exactly this shape and exactly this fix:
// `<main>` carries `tabIndex={-1}` for the skip link, it is where the skip link
// goes, and it is the content the visitor came for. `preventScroll` because
// yanking the viewport after a dismissal is disorienting on its own.
//
// The three GET-submit refusals this row also fixes need no script at all — a
// fragment does it — but this form posts a SERVER ACTION, so with JavaScript on
// React re-renders in place and there is no navigation for a fragment to ride.
// With JavaScript off nothing here runs and the post is a full document load,
// which starts at the top of a new page anyway.
//
// Only the button is a client component, not the whole offer: `LanguageOffer`
// calls `dictionaryFor('es')`, and making that file client would put the entire
// Spanish dictionary in the bundle of every public page.
export function OfferAnswer({
  locale,
  className,
  children,
}: {
  locale: 'en' | 'es'
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      name="locale"
      value={locale}
      // Fires before the action resolves, which is what makes it work: `<main>`
      // survives the re-render, so focus is already somewhere deliberate when
      // the region around this button disappears.
      onClick={() => document.getElementById('main')?.focus({ preventScroll: true })}
      className={className}
    >
      {children}
    </button>
  )
}
