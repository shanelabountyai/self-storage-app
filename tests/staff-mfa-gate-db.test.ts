import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'

// SEC-07. The enrolment check used to live only in the admin layout, which
// guards a render: a server action, a `*.csv` route and `/api/facilities/*`
// all resolve their actor through `requireStaffActor` without rendering it.
// This runs the real gate against a real row, with only the session stubbed.

let sessionStaffId = ''
vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: sessionStaffId, audience: 'staff' } }),
}))
vi.mock('@/lib/impersonation/context', () => ({ currentImpersonation: async () => null }))

import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import { MfaEnrollmentRequiredError, requireStaffActor } from '../apps/web/lib/rbac/session'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

describeDb('requireStaffActor refuses unenrolled staff (SEC-07)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: {
        email: `mfa-gate-${randomUUID().slice(0, 8)}@example.com`,
        firstName: 'Nia',
        lastName: 'Newhire',
      },
    })
    sessionStaffId = staff.id
  })

  afterAll(async () => {
    // Never audit-logged against, so unlike most staff fixtures it can go.
    if (sessionStaffId) await prisma.staffUser.delete({ where: { id: sessionStaffId } })
  })

  it('refuses before enrolment, as a ForbiddenError every caller already handles', async () => {
    const refusal = await requireStaffActor().catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(MfaEnrollmentRequiredError)
    expect(refusal).toBeInstanceOf(ForbiddenError)
  })

  it('still lets the enrolment screen resolve them, or nobody could ever enrol', async () => {
    const actor = await requireStaffActor({ allowUnenrolled: true })
    expect(actor.staffUserId).toBe(sessionStaffId)
  })

  it('lets them through once enrolled', async () => {
    await prisma.staffUser.update({
      where: { id: sessionStaffId },
      data: { totpConfirmedAt: new Date() },
    })
    expect((await requireStaffActor()).staffUserId).toBe(sessionStaffId)
  })
})
