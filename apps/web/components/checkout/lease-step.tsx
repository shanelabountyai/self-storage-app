import { AdminForm, Field } from '@/components/admin/form'
import { signLeaseAction } from '@/app/(public)/checkout/actions'
import { ELECTRONIC_RECORDS_CONSENT } from '@/lib/lease/template'

// PRD 01 US-501 step 4 / FR-4.2.
//
// Three things this gets right on purpose:
//
// 1. The plain-language summary is real page content ABOVE the full text, not a
//    tooltip and not a collapsed panel (§6.4).
// 2. The signature control is NOT gated on scrolling. §6.4 is explicit that
//    "scrolled to bottom" is hostile and simply broken for a screen-reader user
//    who never scrolls — the summary being on the page is the gate, and it
//    always is.
// 3. The lease renders as ordinary, scrollable page content — not a fixed-height
//    box with hidden overflow, and not an image of a document.

export function LeaseStep({
  token,
  summaryHtml,
  leaseHtml,
  legalName,
}: {
  token: string
  summaryHtml: string
  leaseHtml: string
  legalName: string
}) {
  return (
    <div className="mt-4">
      {/* Both blocks are server-rendered from templates we control and whose
          merged values are escaped at render time (B-023), so the only markup
          here is our own. `lease-summary` is the id on the summary template's
          own <h2> — it had none until B-110, so this reference dangled and the
          plain-language summary was an unnamed region rather than a landmark a
          screen-reader user could jump to. */}
      <section
        aria-labelledby="lease-summary"
        className="border-input rounded-lg border p-4"
        dangerouslySetInnerHTML={{ __html: summaryHtml }}
      />

      <section aria-labelledby="lease-full" className="mt-6">
        <h2 id="lease-full" className="text-xl font-medium">
          The full agreement
        </h2>
        <div
          className="prose-sm mt-3 max-w-none"
            dangerouslySetInnerHTML={{ __html: leaseHtml }}
        />
      </section>

      <AdminForm action={signLeaseAction} label="Sign the lease" className="mt-8">
        <input type="hidden" name="token" value={token} />

        <h2 className="text-xl font-medium">Sign</h2>

        {/* Consent to transact electronically is its own affirmative act under
            E-SIGN — not something the signature implies — so it is a separate
            control, unticked by default. Through `Field` so that refusing the
            sign marks THIS box invalid, rather than only listing the reason in
            an error summary a control-by-control navigator never passes. */}
        <Field
          as="checkbox"
          name="consented"
          value="yes"
          label={ELECTRONIC_RECORDS_CONSENT}
          className="mt-3 text-sm"
        />

        <div className="mt-4 max-w-sm">
          <Field
            name="typedName"
            label="Type your full name to sign"
            autoComplete="off"
            // 3.3.2 Labels or Instructions: say what typing the name means
            // before they do it, not after it is rejected.
            hint={`Type it exactly as it appears on the lease: ${legalName}. Typing your name here is your signature.`}
          />
        </div>

        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          Sign and continue
        </button>
        <p className="text-muted-foreground mt-2 text-sm text-pretty">
          You will get a copy by email, and you can download it any time. Nothing is charged until
          the next step.
        </p>
      </AdminForm>
    </div>
  )
}
