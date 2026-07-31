import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'

export const metadata = metadataFor('Terms of service', 'Draft terms — not legal advice.')

export default function TermsPage() {
  return (
    <ProsePage
      title="Terms of service"
      intro="The rules for using this website. Your storage rental is governed by the lease you sign, not by this page."
      draftNotice
    >
      <Section heading="Using this site">
        <p>
          You may browse, search, reserve, and manage a rental here. Don&apos;t try to
          break it, scrape it at volume, or use it to store or transmit anything unlawful.
        </p>
      </Section>

      <Section heading="Prices and availability">
        <p>
          Prices and availability shown are live, but a unit is only yours once a
          reservation or lease confirms it. If a unit is taken between the moment you see
          it and the moment you commit, we will say so and offer the closest alternative
          rather than silently substituting one.
        </p>
      </Section>

      <Section heading="Your rental agreement">
        <p>
          The lease you sign at move-in governs the rental itself — rent, due dates, late
          fees, access, insurance or protection, notice periods, and what happens if an
          account goes unpaid. Where this page and that lease disagree, the lease wins.
        </p>
      </Section>

      <Section heading="Your account">
        <p>
          Keep your sign-in details to yourself. Tell us promptly if you think someone
          else has access to your account.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          These terms can change. Material changes would be communicated before they take
          effect rather than posted silently.
        </p>
      </Section>
    </ProsePage>
  )
}
