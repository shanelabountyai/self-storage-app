import { AdminForm, Field } from '@/components/admin/form'
import type { FormState } from '@/lib/admin/form-state'

// PRD 04 §3.6 US-11 AC3 (B-122). The code box inside the checkout.
//
// A second component rather than reusing the facility page's `PromoCodeEntry`,
// and the difference is not cosmetic: that one is a GET form putting the code
// in the URL, because a browse page has no session to write to. Here there IS
// one, so the code goes to a server action that re-evaluates it and rewrites
// the session's promo snapshot — the same snapshot the summary, the amount due
// today and the redemption row all read. Trying to serve both from one
// component would mean a prop that switches between a query string and a
// mutation, which is two components wearing one name.
//
// `AdminForm` carries the accessibility contract this needs and already has it
// right: `fieldError` wires `aria-invalid` and `aria-describedby` onto the
// input (B-094), the success line is a pre-mounted `role="status"` rather than
// a node inserted already populated (B-111), and B-124 keeps what was typed on
// the error branch — which matters here more than most, since the thing being
// retyped is a code the renter copied from an email.

export function PromoCodeStep({
  token,
  action,
  appliedTerms,
}: {
  token: string
  /// The same signature `AdminForm` takes. Typed properly rather than `any`:
  /// the earlier `any` needed an eslint-disable, and an edit that inserted a
  /// comment between the directive and its target silently un-suppressed it —
  /// a lint error is the cheap version of that lesson.
  action: (state: FormState, formData: FormData) => Promise<FormState>
  /// The promotion currently on this checkout, if any. Shown so the renter can
  /// see what a code would be competing with — FR-PROMO-4 allows only one, and
  /// "why did nothing change" is the support call this prevents.
  appliedTerms?: string | null
}) {
  return (
    <details className="border-input mt-4 rounded-lg border p-3">
      {/* Collapsed by default, and a <details> rather than a JS disclosure so
          it works with the bundle off like the rest of the public path. Most
          renters have no code, and an open field asking for one reads as a
          discount everybody else is getting — which is its own reason to
          abandon a checkout. */}
      <summary className="cursor-pointer text-sm font-medium">Have a promo code?</summary>

      {appliedTerms && (
        <p className="text-muted-foreground mt-2 text-sm">
          Currently applied: {appliedTerms}. Only one promotion applies at a time — if the code you
          enter is worth less, we will keep this one.
        </p>
      )}

      {/* The FORM's name, which must not repeat the field's. Both were "Promo
          code", so a screen reader announced "Promo code, form — Promo code,
          edit text" and neither said what the form was for. */}
      <AdminForm action={action} label="Add a promo code" className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="token" value={token} />
        <Field
          name="promo"
          label="Promo code"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="e.g. SUMMER25"
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
        >
          Apply code
        </button>
      </AdminForm>
    </details>
  )
}
