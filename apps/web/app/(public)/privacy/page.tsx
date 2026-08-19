import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'

export const metadata = metadataFor('Privacy', 'Draft privacy notice — not legal advice.')

export default function PrivacyPage() {
  return (
    <ProsePage
      title="Privacy"
      intro="What we collect, why, and what we deliberately don't do."
      draftNotice
    >
      <Section heading="What we collect">
        <p>
          To rent you a unit we need your name, contact details, billing address, and
          the details of your rental. If you reserve without renting, we keep only what
          you gave us on the reservation.
        </p>
      </Section>

      <Section heading="Card details">
        <p>
          We never see or store your full card number. Payment fields are hosted by our
          payment processor and submitted directly to them; we keep only a token that
          lets us charge the card you authorised, plus the last four digits so you can
          tell your cards apart.
        </p>
      </Section>

      <Section heading="Gate codes">
        <p>
          Your gate code is stored as a reference rather than as readable text, and staff
          need a separate, individually recorded permission to reveal one. Looking at
          your account is not the same as being able to read your code.
        </p>
      </Section>

      <Section heading="Messages you get from us">
        <p>
          Messages about your account — receipts, payment reminders, notices — are part
          of the rental. Marketing messages are separate and need your explicit opt-in,
          which you can withdraw at any time without affecting account messages.
        </p>
      </Section>

      {/* PRD 09 OQ-1 (B-091 part 2). The disclosure the feature implies, drafted
          here because part 2 is what first puts a staff member in front of a
          tenant's account. Still DRAFT and not legal advice — §10 requires
          attorney review before real staff view real accounts, and the page
          carries `draftNotice` for exactly that reason.

          It says out loud that we do not notify you (D-13a/FR-16). That is the
          uncomfortable half, and leaving it out is what would make the decision
          indefensible: not telling someone is a choice a policy can disclose,
          whereas a policy that is silent about it has simply not been written.
          D-10 makes Texas the seeded compliance default; §5.4's note is that
          expanding beyond it re-opens this question rather than inheriting the
          answer. */}
      <Section heading="Staff access to your account">
        <p>
          Staff can view your account to help you, and every privileged action is written
          to a record that cannot be edited or deleted afterwards.
        </p>
        <p>
          For support, a member of staff can also open your account and see it the way you
          see it — the same balance, the same units, the same screens. That kind of session
          is read-only: while it is running nothing can be changed, no payment can be taken
          or refunded, no message can be sent to you, and your gate code stays hidden. It
          needs a stated reason, expires by itself after thirty minutes, and is recorded
          — who opened it, when, why, and when it ended — in the same record that cannot
          be edited or deleted.
        </p>
        <p>
          We do not send you an alert when this happens. If you would like to know whether
          anyone has opened your account, and why, email{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>{' '}
          and we will tell you from that record.
        </p>
      </Section>

      <Section heading="How long we keep things">
        <p>
          Rental and payment records are kept as long as tax and lien law require. Access
          events age out on a schedule. We aim to collect only what leasing and the law
          actually need.
        </p>
      </Section>

      <Section heading="Asking us about your data">
        <p>
          Email{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>{' '}
          and we will tell you what we hold about you.
        </p>
      </Section>
    </ProsePage>
  )
}
