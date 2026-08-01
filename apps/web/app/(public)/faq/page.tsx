import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'

export const metadata = metadataFor(
  'Frequently asked questions',
  'How reservations, move-ins, gate access, and billing work.',
)

export default function FaqPage() {
  return (
    <ProsePage
      title="Frequently asked questions"
      intro="Short answers to what people ask most. Call us if yours isn't here."
    >
      <Section heading="Do I need to pay to reserve a unit?">
        <p>
          No. Reservations are free, need no card, and need no account — just your name,
          email, phone, and the date you want to move in. The hold expires on its own if
          you don&apos;t move in.
        </p>
      </Section>

      <Section heading="Can I rent entirely online?">
        <p>
          Yes. You pick a unit, sign the lease electronically, pay the first amount due,
          and get your gate code — without visiting an office.
        </p>
      </Section>

      <Section heading="Is there a long-term contract?">
        <p>
          No. Rentals are month-to-month. You give notice according to your lease and
          move out.
        </p>
      </Section>

      <Section heading="What is the difference between the online and in-store price?">
        <p>
          Some sizes cost less when you rent online than when you rent at the counter.
          Both prices are shown before you commit, so you can see which one applies to
          you. Reserving does not change the price — renting online is what does.
        </p>
      </Section>

      {/* The question the size-help links on the search and facility pages point
          at. Until B-017 ships the real size guide with diagrams, this is the
          answer they land on — pointing someone at a page that ignored their
          question was worse than not linking. */}
      <Section heading="What size do I need?">
        <p>
          A rough guide, and we will happily talk it through on the phone:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>5 by 5 feet</strong> — a large closet. Boxes, seasonal decorations, a
            bike, a few pieces of small furniture.
          </li>
          <li>
            <strong>10 by 10 feet</strong> — about half a garage, or the contents of a
            one-bedroom apartment including a sofa and a mattress set.
          </li>
          <li>
            <strong>10 by 20 feet</strong> — a single garage. A three-bedroom house, or a
            car with room left over.
          </li>
        </ul>
        <p>
          If you are between two sizes, take the larger one. Paying a little more beats
          discovering on moving day that the last of it does not fit.
        </p>
      </Section>

      <Section heading="When can I get to my unit?">
        <p>
          Office hours and gate hours are different, and both are listed on every
          facility page. Gate hours are when you can reach your unit; office hours are
          when staff are there.
        </p>
      </Section>

      <Section heading="Something else?">
        <p>
          Call{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>{' '}
          or email{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
          .
        </p>
      </Section>
    </ProsePage>
  )
}
