import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'

export const metadata = metadataFor('Contact', 'How to reach us.')

export default function ContactPage() {
  return (
    <ProsePage title="Contact" intro="The fastest way to reach us is the phone.">
      <Section heading="Phone">
        <p>
          <a href={`tel:${SITE.phone.href}`} className="text-lg underline underline-offset-4">
            {SITE.phone.display}
          </a>
        </p>
      </Section>

      <Section heading="Email">
        <p>
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
        </p>
      </Section>

      <Section heading="A specific facility">
        <p>
          Each facility lists its own phone number, office hours, and gate hours on its
          page. Those reach the site directly.
        </p>
      </Section>
    </ProsePage>
  )
}
