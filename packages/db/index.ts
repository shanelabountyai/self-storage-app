import { PrismaClient } from './generated/client'

// Reused across hot reloads in dev so Next.js doesn't open a new pool per edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export * from './generated/client'
