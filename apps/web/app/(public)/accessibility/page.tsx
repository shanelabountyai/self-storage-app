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
const LAST_REVIEWED = '14 August 2026'

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
//
// Re-verified 2026-08-14, and it had gone stale in BOTH directions in twelve
// days — which is the lesson worth keeping. It disclaimed renting, paying and
// account management as "not built yet" when all three had shipped, so the page
// was publicly certifying that the money path had never been assessed. It
// understated form errors, which B-094 had since built properly. And it still
// claimed automated tests on "every page" plus recorded screen-reader passes,
// when `/messaging-policy` is in no scan, the sign-in and account-security
// pages are in none at all, checkout is scanned only in its "session not found"
// state, and PROGRESS.md's own B-093 entry says in as many words that the
// VoiceOver pass has never been run.
//
// This file is a claim about the codebase, so it goes stale on merges rather
// than on edits. CLAUDE.md's end-of-item checklist now names it for that reason.
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
          <li>
            When a form rejects something you typed, the message is tied to the field
            itself, so a screen reader reads it out with that field rather than leaving you
            to hunt for it. A successful save is announced too.
          </li>
          <li>Animation respects your system&apos;s reduced-motion setting.</li>
          <li>
            Where we embed a map, the address and a directions link are given as text
            first, so you never need the map to find us.
          </li>
        </ul>
      </Section>

      <Section heading="How we check">
        <p>
          Automated accessibility tests run on every change, at both phone and desktop
          widths, and they block a release if they fail. They also fail on checks the tool
          could not decide, so &ldquo;we did not test that&rdquo; cannot quietly read as
          &ldquo;that passed&rdquo;.
        </p>
        <p>
          They do not yet cover everything. As of {LAST_REVIEWED} our text-message policy
          page, our sign-in and account-security pages, and the rental checkout in its
          working state are all outside that run. We would rather name the gaps than let a
          general claim cover them.
        </p>
        <p>
          Automated testing is a floor, not a ceiling — it catches roughly a third of real
          problems, and it cannot judge whether a screen reader says something that makes
          sense. We test by keyboard by hand. <strong>A full screen-reader pass has not
          been carried out yet</strong>, so nothing on this page rests on one.
        </p>
      </Section>

      <Section heading="Where we fall short today">
        <p>
          This site is under active construction. These are the problems we know about, as
          of {LAST_REVIEWED}. If one of them blocks you, tell us and we will help you
          finish what you were doing by phone or email in the meantime.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Renting online.</strong> Moving between steps does not move your place
            on the page or say that the step changed, so a screen-reader user gets no
            signal they have advanced. Saved checkouts you return to by email repeat the
            page heading. The lease summary is announced by the wrong name.
          </li>
          <li>
            <strong>The 30-minute hold on a unit is not announced.</strong> The countdown
            is shown when the page is drawn and never updates, so if you are reading the
            lease when it runs out, the expiry is the first you hear of it.
          </li>
          <li>
            <strong>Paying.</strong> While a card is being confirmed the pay button becomes
            unavailable, which loses your place on the page, and the wait is not announced.
          </li>
          <li>
            <strong>Tick boxes and radio buttons</strong> — agreeing to the lease, choosing
            a protection level, turning on autopay — do not carry their error on the
            control itself, so moving between controls does not tell you which one is
            wrong. The message is on screen next to it.
          </li>
          <li>
            <strong>Our staff-facing screens</strong> have known problems. Three of them do
            not reflow at 320px wide, and long lists are not paginated. No customer uses
            them, but we are not going to describe them as done.
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
