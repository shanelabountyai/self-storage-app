import type { Metadata } from 'next'
import Link from 'next/link'
import { SMS_CONFIRM_KEYWORD, SMS_OPT_IN_KEYWORD } from '@storage/core/comms'
import { SITE } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Text message policy',
  description:
    'How we use text messages: what we send, how you agree to receive them, how to stop them, and what they cost.',
}

// PRD 05 CN-14 / §6.4. The public disclosure page a carrier and an A2P 10DLC
// campaign review expect to find, and the page the portal's consent control
// points at.
//
// EVERY CLAIM HERE IS TRUE OF THE BUILD, and that is the whole point of writing
// it from the code rather than from a template:
//
//   - the keyword sets are `packages/core/comms/sms-keywords.ts`
//   - the quiet-hours window is `Facility.smsQuietHoursStartHour/EndHour`
//     (8/21 by default) and applies to EVERY message, not only marketing
//   - consent is a `Consent` row with a timestamp, a source and a disclosure
//     version, shown back to the tenant at /portal/notifications
//
// A page that promises something the system does not do is worse than no page:
// it is the document a regulator reads when somebody complains.

const LAST_REVIEWED = 'August 2026'

export default function MessagingPolicyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Text message policy</h1>
        <p className="text-muted-foreground text-sm">
          {SITE.name} · Last reviewed {LAST_REVIEWED}
        </p>
      </header>

      <p className="text-pretty">
        This page explains the text messages {SITE.name} sends, how you agree to receive them, and
        how to stop them at any time. It applies to every mobile number we hold.
      </p>

      <section aria-labelledby="consent" className="flex flex-col gap-3">
        <h2 id="consent" className="text-lg font-medium">
          How you agree to receive texts
        </h2>
        <p className="text-pretty">
          We never text a number that has not agreed to hear from us.
        </p>
        <p className="text-pretty">
          <strong>
            Text {SMS_OPT_IN_KEYWORD} to {SITE.smsNumber.display}, then reply{' '}
            {SMS_CONFIRM_KEYWORD} when we ask.
          </strong>{' '}
          Texting the keyword does not subscribe you on its own — we reply asking you to confirm,
          and only your {SMS_CONFIRM_KEYWORD} switches the messages on. Both of our replies tell you
          how often we text, that message and data rates may apply, and how to stop.
        </p>
        <p className="text-pretty">
          If we do not recognise the number you text from, we say so and subscribe nothing — call us
          and we will add it to your account first.
        </p>
        <p className="text-pretty">
          You can also turn text messages on yourself, in the <strong>Notifications</strong> section
          of your online account, or by telling our staff to switch them on for you.
        </p>
        <p className="text-pretty">
          When you do, we record the date and time, where the consent came from, and the exact
          version of the wording you agreed to. You can see all of that on your own Notifications
          page at any time — including the fact that we have never asked you, if we have not.
        </p>
        <p className="text-pretty">
          <strong>Consent is not a condition of renting from us.</strong> You can rent, pay and
          manage your unit entirely without text messages; we will email you instead.
        </p>
      </section>

      <section aria-labelledby="what" className="flex flex-col gap-3">
        <h2 id="what" className="text-lg font-medium">
          What we send
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong>Account and payment messages</strong> — your gate code when you move in, a
            reminder before rent is due, a notice if a payment fails, and a message if your gate
            access changes.
          </li>
          <li>
            <strong>Occasional offers</strong>, only if you have separately agreed to marketing
            messages. These are a different permission from the account messages above, and you can
            hold one without the other.
          </li>
        </ul>
        <p className="text-pretty">
          <strong>Message frequency varies.</strong> Most months you will receive around one to four
          messages. A month in which a payment fails, or in which your account falls behind, will
          include more.
        </p>
      </section>

      <section aria-labelledby="stop" className="flex flex-col gap-3">
        <h2 id="stop" className="text-lg font-medium">
          How to stop them
        </h2>
        <p className="text-pretty">
          Reply <strong>STOP</strong> to any message from us. We also accept{' '}
          <strong>STOPALL</strong>, <strong>UNSUBSCRIBE</strong>, <strong>CANCEL</strong>,{' '}
          <strong>END</strong> and <strong>QUIT</strong>. You will get one message confirming it,
          and then nothing further to that number.
        </p>
        <p className="text-pretty">
          Stopping texts stops <em>all</em> of them, including account and payment messages — not
          just the offers. We will keep emailing you about your account, because those messages are
          part of your rental agreement.
        </p>
        {/* B-123 / D-51. The marketing-only switch now exists, so the page has
            to say so: telling somebody their only option is STOP, when STOP
            also costs them their gate code, pushes them into giving up more
            than they meant to. */}
        <p className="text-pretty">
          <strong>If it is only the offers you want to stop</strong>, do not reply STOP — turn
          marketing texts off on your{' '}
          <strong>Notifications</strong> page instead. That leaves your account and payment texts
          working, and you can switch the offers back on there whenever you like.
        </p>
        <p className="text-pretty">
          To start again, reply <strong>START</strong> or <strong>UNSTOP</strong>, or turn texts
          back on from your Notifications page. For help, reply <strong>HELP</strong> — you will get our
          phone number and a link back to this page.
        </p>
        <p className="text-pretty">
          You can also switch them off yourself, without texting anything, in the{' '}
          <strong>Notifications</strong> section of your online account. That has exactly the same
          effect as replying STOP.
        </p>
      </section>

      <section aria-labelledby="hours" className="flex flex-col gap-3">
        <h2 id="hours" className="text-lg font-medium">
          When we send them
        </h2>
        <p className="text-pretty">
          We only text between <strong>8am and 9pm</strong> in the local time of the facility you
          rent from, and that applies to every message including account and payment ones. Anything
          that would fall outside those hours waits, or is emailed instead. Individual facilities may
          use a narrower window where their state requires it.
        </p>
      </section>

      <section aria-labelledby="cost" className="flex flex-col gap-3">
        <h2 id="cost" className="text-lg font-medium">
          Cost
        </h2>
        <p className="text-pretty">
          <strong>Message and data rates may apply.</strong> We do not charge you for text messages;
          your mobile carrier may, depending on your plan. Carriers are not liable for delayed or
          undelivered messages.
        </p>
      </section>

      <section aria-labelledby="privacy" className="flex flex-col gap-3">
        <h2 id="privacy" className="text-lg font-medium">
          Your information
        </h2>
        <p className="text-pretty">
          We do not sell your mobile number, and we do not share it with anyone for their own
          marketing. We share it only with the messaging provider that delivers the texts on our
          behalf. Our{' '}
          <Link href="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>{' '}
          covers what else we hold and why, and our{' '}
          <Link href="/terms" className="underline underline-offset-4">
            terms
          </Link>{' '}
          cover your rental agreement.
        </p>
      </section>

    </main>
  )
}
