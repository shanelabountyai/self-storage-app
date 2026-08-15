import type { CodeOutcome } from '@storage/core/promotions'
import { describeCodeOutcome } from '@storage/core/promotions'

// PRD 04 §3.6 US-11 AC3, §4.5 FR-PROMO-2/3 (B-122). Where a renter types a
// promo code.
//
// `offerFor` has taken a `code` since B-070 and no surface passed one, so a
// code-gated promotion could be created in admin, was correctly hidden from the
// badges, and could never be redeemed by anybody — `PromoCode.usesCount` had no
// path to increment at all.
//
// A GET form with a named input, not a client component: the public path works
// with the bundle disabled (the same rule the checkout and the reserve form
// follow), the code lands in the URL so it is shareable and survives a reload,
// and the server re-evaluates it on the render that follows. Nothing about the
// discount is decided here — a promotion the browser can name is a discount the
// browser can choose, so this only ever transmits the string the renter typed.

export type PromoCodeEntryProps = {
  /// Where the form posts. A GET target on the facility page (the code becomes
  /// a query parameter); the checkout passes a server action instead.
  action?: string
  /// Rendered as hidden inputs so a GET form does not drop the filters, sort
  /// and size the renter already chose.
  ///
  /// Values may repeat: `features` is a checkbox group, and `parseFilters` reads
  /// repeated parameters rather than a comma-joined string — joining them would
  /// produce one value matching no `FeatureKey`, so every feature filter would
  /// be silently dropped the moment somebody applied a code.
  carry?: Record<string, string | string[]>
  /// What the code they last typed came to. Null before they have typed one.
  outcome: CodeOutcome | null
  /// Echoed back so the field is not empty after a refusal — 3.3.3 again: an
  /// error that clears the thing it is complaining about makes the renter type
  /// it a second time to find out what was wrong with it.
  value?: string
  children?: React.ReactNode
}

export function PromoCodeEntry({ action, carry, outcome, value, children }: PromoCodeEntryProps) {
  const message = outcome ? describeCodeOutcome(outcome) : null
  // `applied` and `superseded` are not errors: one is the discount working and
  // the other is us keeping a better one. Only `rejected` is wired to
  // `aria-invalid` and the error styling, or a renter who typed a valid code
  // gets a red message telling them they succeeded.
  const failed = outcome?.kind === 'rejected'

  return (
    <form method="GET" action={action} className="border-input rounded-lg border p-3">
      {Object.entries(carry ?? {}).flatMap(([name, carried]) =>
        (Array.isArray(carried) ? carried : [carried]).map((one) => (
          <input key={`${name}:${one}`} type="hidden" name={name} value={one} />
        )),
      )}
      <label htmlFor="promo" className="text-sm font-medium">
        Have a promo code?
      </label>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <input
          id="promo"
          name="promo"
          type="text"
          defaultValue={value ?? ''}
          autoCapitalize="characters"
          autoComplete="off"
          aria-invalid={failed || undefined}
          aria-describedby={message ? 'promo-outcome' : undefined}
          className="border-input bg-background min-h-11 min-w-0 flex-1 rounded-md border px-3 text-sm"
          placeholder="e.g. SUMMER25"
        />
        {/* "Apply code", not "Apply". The filter form on the same page already
            has an "Apply" button, and two controls with identical accessible
            names doing different things is what a screen-reader user meets as
            "Apply, button ... Apply, button" with nothing to tell them apart
            (WCAG 2.4.6). Found by a Playwright strict-mode violation, which is
            the same ambiguity measured a different way. */}
        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Apply code
        </button>
      </div>

      {/* Rendered unconditionally and empty, never `hidden` — B-111's lesson,
          and `gate-code-panel.tsx` names the file it cost: a live region styled
          `empty:hidden` is `display:none`, which keeps it out of the
          accessibility tree until the instant it has text, and a region that
          appears WITH its own content announces nothing. */}
      <p
        id="promo-outcome"
        role="status"
        className={`mt-2 text-sm empty:mt-0 ${failed ? 'text-red-700' : 'font-medium'}`}
      >
        {message ?? ''}
      </p>

      {children}
    </form>
  )
}
