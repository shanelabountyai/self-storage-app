import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'

export const metadata = metadataFor('About', 'What this project is.')

export default function AboutPage() {
  return (
    <ProsePage title="About" intro="A small self-storage operator, run on software we own.">
      <Section heading="What we are">
        <p>
          We run a handful of self-storage facilities and built the software that runs
          them, rather than renting it per site per month. That means the prices and
          availability you see come from the same system the front desk uses — not a
          nightly export.
        </p>
      </Section>

      <Section heading="A note on this site">
        <p>
          This is a learning project built to production standards. The facilities,
          tenants, and prices shown are demonstration data, and nothing here is a real
          offer of storage.
        </p>
      </Section>
    </ProsePage>
  )
}
