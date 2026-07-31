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

      <Section heading="Staff access to your account">
        <p>
          Staff can view your account to help you, and every privileged action is written
          to a record that cannot be edited or deleted afterwards.
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
