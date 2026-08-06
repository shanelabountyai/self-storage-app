import type { Prisma } from '@storage/db'

// PRD 02 US-17's gapless per-facility invoice numbering, shared by every path
// that raises an invoice — the recurring run (B-044) and late fees (B-047).
// One counter, so the two cannot interleave into a series with holes.

/// Hands out the next invoice number for a facility.
///
/// Must run inside the transaction that writes the invoice: the UPDATE takes a
/// row lock that serialises concurrent runs, and a rollback returns the number
/// to the pool. That is the difference between "unique" and "gapless" (US-17),
/// and why this is not `autoincrement()`. Same shape as `nextReceiptNumber`
/// (D-22) — deliberately, so there is one pattern to understand, not two.
export async function nextInvoiceNumber(tx: Prisma.TransactionClient, facilityId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ nextNumber: number }[]>`
    INSERT INTO "invoice_counter" ("facilityId", "nextNumber", "updatedAt")
    VALUES (${facilityId}, 2, NOW())
    ON CONFLICT ("facilityId")
    DO UPDATE SET "nextNumber" = "invoice_counter"."nextNumber" + 1, "updatedAt" = NOW()
    RETURNING "nextNumber" - 1 AS "nextNumber"
  `
  return rows[0].nextNumber
}
