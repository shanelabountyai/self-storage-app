import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'

export const metadata = metadataFor(
  'Accessibility',
  'Our accessibility target, what we test, and how to tell us when we get it wrong.',
)

// PRD 01 §6.8 requires a public accessibility statement. Unlike the legal
// pages this describes our own conformance, so it is written as a real claim —
// and deliberately states what is *not* done yet rather than implying full
// conformance we have not verified.
export default function AccessibilityPage() {
  return (
    <ProsePage
      title="Accessibility"
      intro="We aim to meet WCAG 2.1 Level AA across every page and every flow."
    >
      <Section heading="What we target">
        <p>
          Web Content Accessibility Guidelines (WCAG) 2.1, Level AA. That covers keyboard
          operation, screen-reader support, colour contrast, text resizing, and reflow on
          small screens.
        </p>
      </Section>

      <Section heading="What that means in practice">
        <ul className="list-disc space-y-1 pl-5">
          <li>Every page works with a keyboard alone, with a visible focus indicator.</li>
          <li>
            Colour is never the only way we tell you something — a status shown in colour
            is also written in words.
          </li>
          <li>Text can be resized to 200% and the page reflows to 320px wide without sideways scrolling.</li>
          <li>Form fields have real labels, and errors are announced rather than only shown in red.</li>
          <li>Animation respects your system&apos;s reduced-motion setting.</li>
        </ul>
      </Section>

      <Section heading="How we check">
        <p>
          Automated accessibility tests run against every page on every change, and they
          block a release if they fail. Automated tests catch perhaps half of real
          problems, so the rental and payment flows also get a manual keyboard and
          screen-reader pass before each release.
        </p>
      </Section>

      <Section heading="Where we fall short today">
        <p>
          This site is under active construction, and several flows described in our plans
          are not built yet. We would rather say so than claim conformance for pages that
          do not exist. Known gaps are fixed as those flows ship, not afterwards.
        </p>
      </Section>

      <Section heading="Tell us when we get it wrong">
        <p>
          If something here blocks you, email{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>{' '}
          or call{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>
          . Tell us the page and what happened, and we will fix it and reply. An
          accessibility barrier is a bug, and we treat it as one.
        </p>
      </Section>
    </ProsePage>
  )
}
