import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminActor } from '@/lib/admin/context'
import { messageForPrint } from '@/lib/admin/message-print'
import { PrintLetterButton } from '@/components/admin/print-letter-button'

export const metadata = {
  title: 'Letter',
  robots: { index: false, follow: false },
}

// B-318. The stored letter, on paper.
//
// B-281 renders the message for a tenant with no email address and keeps it on
// the `Message` row; this is where it becomes something a manager can put in an
// envelope. For a cash-renter cohort this is the only delivery channel there
// is, so the path from "the system could not email them" to "it is in the post"
// has to be two clicks, not a disclosure, a 256px scroll box and a mouse
// selection pasted into Word.
//
// The page is inside the admin layout, whose header and side nav both carry
// `print:hidden` — so what reaches the paper is the <article> below and nothing
// else. `print:hidden` is `display: none` in the PRINT media only; every word
// of it is still in the accessibility tree on screen, which is the difference
// between hiding chrome from a printer and hiding content from a reader.

function formatLetterDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

const ADDRESS_LINE = 'leading-snug'

export default async function MessagePrintPage({
  params,
}: {
  params: Promise<{ messageId: string }>
}) {
  const { messageId } = await params
  const actor = await getAdminActor()
  const letter = await messageForPrint(actor, messageId)
  if (!letter) notFound()

  return (
    <div className="flex max-w-2xl flex-col gap-6 print:max-w-none">
      <div className="flex flex-col gap-2 print:hidden">
        <h1 className="text-lg font-semibold">Letter for {letter.tenantName}</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          The message as it was composed on {formatLetterDate(letter.createdAt, letter.timezone)}.
          Printed and mailed, this is how a tenant with no working email address is told — and it
          is the record that they were.
        </p>
        <p className="text-sm">
          <Link
            href={`/admin/tenants/${letter.tenantId}`}
            className="underline underline-offset-2"
          >
            Back to {letter.tenantName}&apos;s account
          </Link>
        </p>
      </div>

      {letter.body.trim() === '' ? (
        // The B-281 path records the failure even when the render itself failed
        // — a message with no body is a defect upstream, and printing a blank
        // page would hide it. The message log carries the reason.
        <p role="note" className="border-input rounded-md border p-3 text-sm text-pretty print:hidden">
          This message has no stored text, so there is nothing to print. It failed before it was
          composed — the reason is on the message in the log on this tenant&apos;s account.
        </p>
      ) : (
        <>
          {!letter.to.ok && (
            <p
              role="note"
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 text-pretty print:hidden"
            >
              This tenant&apos;s address of record is missing its {letter.to.missing.join(', ')}, so
              the envelope block below is incomplete and this cannot be recorded as mailed. Add the
              address on their account first — a letter posted without it comes back after the
              deadline it sets.
            </p>
          )}

          {/* The letter itself. Nothing in here is admin chrome, and nothing
              outside it prints. */}
          <article
            aria-labelledby="letter-heading"
            className="border-input flex flex-col gap-8 rounded-md border p-8 text-sm print:rounded-none print:border-0 print:p-0"
          >
            <h2 id="letter-heading" className="sr-only">
              {letter.subject ?? 'Letter'} for {letter.tenantName}
            </h2>

            {/* Return address, top left — the facility, from its own settings. */}
            <address className={`${ADDRESS_LINE} not-italic`}>
              {letter.from.ok ? (
                <>
                  <span className="block font-medium">{letter.from.address.name}</span>
                  <span className="block">{letter.from.address.line1}</span>
                  {letter.from.address.line2 && (
                    <span className="block">{letter.from.address.line2}</span>
                  )}
                  <span className="block">
                    {letter.from.address.city}, {letter.from.address.state}{' '}
                    {letter.from.address.postalCode}
                  </span>
                </>
              ) : (
                <span className="block">
                  {letter.facilityName} — no complete return address on file (missing its{' '}
                  {letter.from.missing.join(', ')}). Fix it in facility settings.
                </span>
              )}
            </address>

            {/* The window-envelope block: the recipient's address of record
                (D-21's newest row, never the cached columns), positioned so a
                standard #10 window shows it and nothing above it. */}
            <address className={`${ADDRESS_LINE} mt-16 ml-12 not-italic`}>
              {letter.to.ok ? (
                <>
                  <span className="block">{letter.to.address.name}</span>
                  <span className="block">{letter.to.address.line1}</span>
                  {letter.to.address.line2 && (
                    <span className="block">{letter.to.address.line2}</span>
                  )}
                  <span className="block">
                    {letter.to.address.city}, {letter.to.address.state}{' '}
                    {letter.to.address.postalCode}
                  </span>
                </>
              ) : (
                <>
                  <span className="block">{letter.tenantName}</span>
                  <span className="block">
                    No address of record — missing {letter.to.missing.join(', ')}
                  </span>
                </>
              )}
            </address>

            <p className="mt-8">{formatLetterDate(letter.createdAt, letter.timezone)}</p>

            {letter.subject && <p className="font-medium">{letter.subject}</p>}

            {/* The stored bytes, verbatim. Not a re-render: the artefact is
                what was composed at the time (CN-18), and a template edited
                since would otherwise put words on paper that were never sent. */}
            <div className="font-sans whitespace-pre-wrap">{letter.body}</div>
          </article>

          <PrintLetterButton
            messageId={letter.messageId}
            tenantName={letter.tenantName}
            closesTask={letter.openTaskId !== null}
          />
        </>
      )}
    </div>
  )
}
