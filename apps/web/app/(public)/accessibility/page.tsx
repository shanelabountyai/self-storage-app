import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'

export const metadata = metadataFor(
  'Accessibility',
  'Our accessibility target, what we test, and how to tell us when we get it wrong.',
)

/// The date the claims below were last checked against the build. A statement's
/// credibility rests on the record, not the intention — an undated one is a
/// claim about a codebase that has since moved. Update this when the claims are
/// re-verified, not when the page is edited.
const LAST_REVIEWED = '31 July 2026'

// PRD 01 §6.8 requires a public accessibility statement. Unlike the legal pages
// this describes our own conformance, so every sentence has to be true of the
// build that is deployed.
//
// B-093 rewrote it. An accessibility audit found four claims here that the code
// did not support: a visible focus indicator (the ring was 1.54–2.59:1 against a
// required 3:1), announced form errors (there was no error handling in the
// codebase at all), automated tests on "every page" (admin and this sign-in page
// were in no scan), and a manual screen-reader pass "before each release" (none
// had ever been recorded). Three are fixed; the rest moved down to the gaps
// section, which is where an unfinished thing belongs.
//
// An overstated accessibility statement is the first document quoted in a demand
// letter, and it converts a fixable bug into an alleged misrepresentation. When
// in doubt, claim less.
export default function AccessibilityPage() {
  return (
    <ProsePage
      title="Accessibility"
      intro="We aim to meet WCAG 2.1 Level AA across every page and every flow. This page says how far we have actually got."
    >
      <Section heading="What we target">
        <p>
          Web Content Accessibility Guidelines (WCAG) 2.1, Level AA. That covers keyboard
          operation, screen-reader support, colour contrast, text resizing, and reflow on
          small screens.
        </p>
      </Section>

      <Section heading="What is true today">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Every page on this public site works with a keyboard alone, and the focus
            indicator meets the 3:1 contrast the guidelines ask for.
          </li>
          <li>
            Colour is never the only way we tell you something — a status shown in colour
            is also written in words.
          </li>
          <li>
            Text can be resized to 200% and the page reflows to 320px wide without
            sideways scrolling.
          </li>
          <li>Form fields have real labels, not just placeholder text.</li>
          <li>Animation respects your system&apos;s reduced-motion setting.</li>
          <li>
            Where we embed a map, the address and a directions link are given as text
            first, so you never need the map to find us.
          </li>
        </ul>
      </Section>

      <Section heading="How we check">
        <p>
          Automated accessibility tests run against every page of this public site on
          every change, at both phone and desktop widths, and they block a release if they
          fail. They also fail on checks the tool could not decide, so &ldquo;we did not
          test that&rdquo; cannot quietly read as &ldquo;that passed&rdquo;.
        </p>
        <p>
          Automated testing is a floor, not a ceiling — it catches roughly a third of real
          problems, and it cannot judge whether a screen reader says something that makes
          sense. Manual keyboard and screen-reader passes are part of how we work, and we
          record each one rather than trusting memory.
        </p>
      </Section>

      <Section heading="Where we fall short today">
        <p>
          This site is under active construction, and several flows described in our plans
          are not built yet. We would rather say so than claim conformance for pages that
          do not exist. Specifically, as of {LAST_REVIEWED}:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Renting online, paying a bill, and managing your account are not built yet, so
            no claim here covers them.
          </li>
          <li>
            Our staff-facing screens have known accessibility problems and are not yet in
            the automated test run. They are being fixed next. No customer uses them, but
            we are not going to describe them as done.
          </li>
          <li>
            Form errors are shown in text next to the field, but are not yet announced to
            screen-reader users as they happen. That work lands with the first flow that
            can produce one.
          </li>
          <li>
            The map we embed comes from OpenStreetMap and is not fully accessible. We
            cannot restyle someone else&apos;s map, so we keep it collapsed behind a
            button and never make it the only way to get the information.
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">Last reviewed: {LAST_REVIEWED}.</p>
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
