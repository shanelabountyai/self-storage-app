import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantActor } from "@/lib/rbac/session";
import { portalDocuments, portalPayments } from "@/lib/portal/documents";
import { formatRate } from "@/lib/format";
import { SITE } from "@/lib/site-config";
import { CallLink, phoneFor } from "@/components/marketing/call-link";

export const metadata: Metadata = { title: "Documents and receipts" };

// PRD 01 §4.7 US-705.

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default async function DocumentsPage() {
  const actor = await requireTenantActor();
  const [documents, payments] = await Promise.all([
    portalDocuments(actor.tenantId),
    portalPayments(actor.tenantId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Documents and receipts</h1>

      <section aria-labelledby="docs-heading" className="flex flex-col gap-3">
        <h2 id="docs-heading" className="font-medium">
          Your documents
        </h2>
        {documents.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            You don&apos;t have any documents on file yet. Your signed agreement
            appears here once you&apos;ve moved in.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <li
                key={document.id}
                className="border-input flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4"
              >
                <span className="text-sm">
                  <span className="font-medium">{document.title}</span>
                  {document.unitNumber && (
                    <span className="text-muted-foreground">
                      {" "}
                      · Unit {document.unitNumber}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatWhen(document.createdAt)}
                  </span>
                </span>
                {/* An uploaded file is downloaded through the authenticated
                    route, never rendered: its bytes came from outside and the
                    viewer page renders markup. */}
                {document.downloadable && (
                  <a
                    href={`/portal/documents/${document.id}/file`}
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                  >
                    Download
                  </a>
                )}
                {document.viewable && (
                  <Link
                    href={`/portal/documents/${document.id}`}
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                  >
                    View
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="payments-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="payments-heading" className="font-medium">
          Payments
        </h2>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            No payments yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">
              Payments on your account, most recent first
            </caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="py-2 font-medium">
                  Unit
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.paymentId} className="border-b">
                  <td className="py-2">
                    {formatWhen(payment.receivedAt)}
                    {/* B-146. In words, not a strikethrough or a colour (WCAG
                        1.4.1) — and it says what it means for the tenant,
                        because the next thing they get is a notice about a
                        period they hold a receipt for.
                        B-179. It used to end "please call us", which asked the
                        tenant to queue on a phone line to do what the next
                        screen does in three taps. The action is here now, and
                        the fee is named because it is part of the total they
                        are about to pay. */}
                    {payment.returned && (
                      <span className="text-muted-foreground block text-pretty">
                        Returned unpaid by the bank, so this amount is owed
                        again
                        {payment.return && payment.return.feeCents > 0
                          ? `, along with a ${formatRate(payment.return.feeCents)} returned-payment fee`
                          : ""}
                        .
                      </span>
                    )}
                    {payment.returned && (
                      <span className="mt-1 block text-pretty">
                        {payment.return?.payableCents != null ? (
                          <>
                            <Link
                              href={`/portal/pay?lease=${payment.return.leaseId}`}
                              aria-label={`Pay ${formatRate(payment.return.payableCents)} now${
                                payment.unitNumber
                                  ? ` on unit ${payment.unitNumber}`
                                  : ""
                              }`}
                              className="font-medium underline underline-offset-4"
                            >
                              Pay {formatRate(payment.return.payableCents)} now
                            </Link>
                            <span className="text-muted-foreground">
                              {" "}
                              or{" "}
                              <CallLink
                                phone={phoneFor(
                                  payment.return.facilityPhone ?? null,
                                )}
                                className="underline underline-offset-4"
                              />
                              .
                            </span>
                          </>
                        ) : (
                          // Nothing to pay online: the lease has ended, or the
                          // balance is already settled. A link to /portal/pay
                          // would land on "we couldn't find that unit", so the
                          // facility's own line is the honest route.
                          <span className="text-muted-foreground">
                            <CallLink
                              phone={phoneFor(
                                payment.return?.facilityPhone ?? null,
                              )}
                              className="underline underline-offset-4"
                            />{" "}
                            about this.
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-2">{payment.unitNumber ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatRate(payment.amountCents)}
                    {/* B-179 (1.4.1). The figure said the money landed and the
                        sentence in the other column said it did not. The state
                        is on the number itself now, in words. */}
                    {payment.returned && (
                      <span className="text-muted-foreground block text-xs font-normal">
                        returned
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-muted-foreground text-sm text-pretty">
          Need a receipt for one of these, or a statement for your accounts?
          Call{" "}
          <a
            href={`tel:${SITE.phone.href}`}
            className="underline underline-offset-4"
          >
            {SITE.phone.display}
          </a>{" "}
          and we&apos;ll send it over.
        </p>
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  );
}
