import { AdminForm, Field } from '@/components/admin/form'
import { advanceAction, signLeaseAction } from '@/app/(public)/checkout/actions'
import { ELECTRONIC_RECORDS_CONSENT } from '@/lib/lease/template'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

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
  leases,
  legalName,
  signedOn,
  altContactName,
  altContactPhone,
  activeDutyMilitary,
  dict,
}: {
  token: string
  /// D-53 (B-106 part 5). One agreement per unit, in basket order. A single
  /// signing action signs all of them — so this is a list to READ, never a list
  /// of separate signature ceremonies.
  leases: readonly { unitName: string; summaryHtml: string; leaseHtml: string }[]
  legalName: string
  /// B-112. Moved off step 1 to bring it under §6.4's field cap. Prefilled from
  /// the session so back navigation does not lose them (B-111's rule).
  altContactName?: string
  altContactPhone?: string
  activeDutyMilitary?: boolean
  /// B-111. Set when this lease has already been signed and the renter has come
  /// BACK to the step — which back navigation makes an ordinary thing to do.
  /// Without it the step offers a signature control that `signDocument` refuses
  /// as `already_signed`, so the renter is told their own lease cannot be
  /// signed and has no way forward at all.
  signedOn?: string
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  return (
    <div className="mt-4">
      {leases.length > 1 && (
        <p className="text-pretty">{t('lease.multiIntro', { count: leases.length })}</p>
      )}

      {leases.map((lease, index) => (
        <div key={lease.unitName} className={index === 0 && leases.length === 1 ? '' : 'mt-6'}>
          {leases.length > 1 && (
            <h2 className="text-xl font-medium">
              {t('lease.agreementFor', { unit: lease.unitName })}
            </h2>
          )}

          {/* Both blocks are server-rendered from templates we control and
              whose merged values are escaped at render time (B-023), so the
              only markup here is our own. `lease-summary` is the id on the
              summary template's own <h2> — it had none until B-110, so this
              reference dangled and the plain-language summary was an unnamed
              region rather than a landmark a screen-reader user could jump to.

              The id is suffixed per agreement: N sections all pointing
              `aria-labelledby` at one id is a duplicate-id violation AND gives
              every region the same accessible name, which is the exact failure
              the row calls out for the Remove controls (4.1.2). The templates
              render their own heading id, so the wrapper carries the suffix. */}
          <section
            aria-label={
              leases.length > 1
                ? t('lease.plainEnglishFor', { unit: lease.unitName })
                : undefined
            }
            aria-labelledby={leases.length > 1 ? undefined : 'lease-summary'}
            className="border-input mt-3 rounded-lg border p-4"
            dangerouslySetInnerHTML={{ __html: lease.summaryHtml }}
          />

          <section aria-labelledby={`lease-full-${index}`} className="mt-6">
            <h3 id={`lease-full-${index}`} className="text-lg font-medium">
              {leases.length > 1
                ? t('lease.fullAgreementFor', { unit: lease.unitName })
                : t('lease.fullAgreement')}
            </h3>
            <div
              className="prose-sm mt-3 max-w-none"
              dangerouslySetInnerHTML={{ __html: lease.leaseHtml }}
            />
          </section>
        </div>
      ))}

      {signedOn ? (
        <AdminForm action={advanceAction} label={t('lease.continueFormLabel')} className="mt-8">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="from" value="lease" />

          <h2 className="text-xl font-medium">{t('lease.signedHeading')}</h2>
          <p className="mt-2 text-pretty">
            {leases.length === 1
              ? t('lease.signedOneBody', { date: signedOn, name: legalName })
              : t('lease.signedManyBody', {
                  count: leases.length,
                  date: signedOn,
                  name: legalName,
                })}
          </p>
          <button
            type="submit"
            className="bg-primary text-primary-foreground mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
          >
            {t('lease.continueToPayment')}
          </button>
        </AdminForm>
      ) : (
      <AdminForm
        action={signLeaseAction}
        label={
          leases.length === 1
            ? t('lease.signOne')
            : t('lease.signMany', { count: leases.length })
        }
        className="mt-8"
      >
        <input type="hidden" name="token" value={token} />

        {/* B-112. Moved here from step 1, which rendered fourteen fields on a
            phone against §6.4's cap of seven. They belong with the agreement
            rather than with "who are you": clause 9 is about where notices go,
            and an active-duty declaration is a legal statement, not a contact
            detail. Both optional, and both say what they are for — an
            unexplained question about someone's military service on a storage
            form is the kind of thing people decline to answer. */}
        <fieldset className="text-sm">
          <legend className="font-medium">{t('lease.altContactLegend')}</legend>
          <p className="text-muted-foreground mt-1 text-pretty">{t('lease.altContactBody')}</p>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              name="altContactName"
              label={t('lease.altContactName')}
              autoComplete="off"
              defaultValue={altContactName ?? ''}
            />
            <Field
              name="altContactPhone"
              label={t('lease.altContactPhone')}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              defaultValue={altContactPhone ?? ''}
            />
          </div>
        </fieldset>

        <Field
          as="checkbox"
          name="activeDutyMilitary"
          value="yes"
          defaultChecked={activeDutyMilitary ?? false}
          className="mt-4 text-sm"
          label={t('lease.activeDuty')}
          hint={t('lease.activeDutyHint')}
        />

        <h2 className="mt-6 text-xl font-medium">{t('lease.signHeading')}</h2>

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
            label={t('lease.typeName')}
            autoComplete="off"
            // 3.3.2 Labels or Instructions: say what typing the name means
            // before they do it, not after it is rejected.
            hint={t('lease.typeNameHint', { name: legalName })}
          />
        </div>

        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          {leases.length === 1
            ? t('lease.submitOne')
            : t('lease.submitMany', { count: leases.length })}
        </button>
        <p className="text-muted-foreground mt-2 text-sm text-pretty">
          {leases.length === 1 ? t('lease.copiesOne') : t('lease.copiesMany')}
        </p>
      </AdminForm>
      )}
    </div>
  )
}
