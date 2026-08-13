import { PrismaClient } from '@prisma/client'

// Reused across hot reloads in dev so Next.js doesn't open a new pool per edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma's defaults for an INTERACTIVE transaction are maxWait 2s and
    // timeout 5s, which are tuned for a database on the same machine. This one
    // is Neon, over the network, where a round trip costs tens of milliseconds
    // — and the longest transactions here (`completeMoveOut` settles a lease,
    // posts the ledger, releases the unit, recomputes its status and closes the
    // verification task) make eight or nine of them.
    //
    // Raised after a full parallel test run aborted one of those transactions
    // mid-flight while the same suite passed on its own and on the next run:
    // the signature of a wall-clock limit under load rather than a defect in
    // the work. In production the same limit would abort a move-out during any
    // latency spike, and surface as an opaque Prisma error to whoever was
    // standing at the counter.
    //
    // Deliberately not enormous. 20 seconds survives a bad minute; a
    // transaction genuinely stuck still gives up rather than holding its rows
    // forever.
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export * from '@prisma/client'
