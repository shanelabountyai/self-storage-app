import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { messageForPrint, recordLetterPrinted } from '../apps/web/lib/admin/message-print'
import { completeTask, createTask } from '../apps/web/lib/admin/tasks'
import { tenantProfile } from '../apps/web/lib/admin/tenants'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-318 / PRD 02 §4.7 US-44; B-281, B-166, B-306.
//
// The letter B-281 renders for a tenant with no email address, and the print
// path that is now the only thing that closes the task it raises.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let staffId = ''

const BODY = 'Your rent is past due.\n\nPlease call the office.\n\n— Storage'

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['tenants:view', 'tenants:edit']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeMessage(overrides: { body?: string; key?: string } = {}) {
  const key = overrides.key ?? randomUUID().slice(0, 8)
  return prisma.message.create({
    data: {
      idempotencyKey: `print-${suffix}-${key}`,
      eventId: `event-${suffix}-${key}`,
      ruleId: 'test-rule',
      templateKey: 'invoice_past_due',
      templateVersion: 3,
      classification: 'transactional',
      channel: 'email',
      recipientTenantId: tenantId,
      facilityId,
      // D-111's tenant: no address to send to, so the row records the failure
      // and the text is the letter somebody prints.
      toAddress: '',
      subjectSnapshot: 'Your rent is past due',
      bodySnapshot: overrides.body ?? BODY,
      status: 'failed',
      error: 'No email address on file',
    },
  })
}

describeDb('printing a stored message', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Print Test ${suffix}`,
        slug: `print-${suffix}`,
        addressLine1: '1 Storage Way',
        addressLine2: 'Suite 200',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { firstName: 'Cash', lastName: `Renter-${suffix}`, email: null, facilityId },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `print-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    // D-21: the address of record is the NEWEST `TenantAddress` row. Two rows,
    // so a print view reading the older one fails here rather than in a lien
    // dispute.
    await prisma.tenantAddress.create({
      data: {
        tenantId,
        addressLine1: '9 Old Street',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        source: 'import',
      },
    })
    await prisma.tenantAddress.create({
      data: {
        tenantId,
        addressLine1: '77 New Street',
        addressLine2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        source: 'counter',
      },
    })
  })

  afterEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.message.deleteMany({ where: { facilityId } })
  })

  it('renders the letter: both addresses, and the stored body verbatim', async () => {
    const message = await makeMessage()

    const letter = await messageForPrint(manager(), message.id)

    expect(letter).not.toBeNull()
    // The artefact, not a re-render — a template edited since must not change
    // what this page prints.
    expect(letter?.body).toBe(BODY)
    expect(letter?.subject).toBe('Your rent is past due')
    expect(letter?.to).toEqual({
      ok: true,
      address: {
        name: `Cash Renter-${suffix}`,
        line1: '77 New Street',
        line2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
      },
    })
    expect(letter?.from).toEqual({
      ok: true,
      address: {
        name: `Print Test ${suffix}`,
        line1: '1 Storage Way',
        line2: 'Suite 200',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
      },
    })
  })

  it('a note cannot close the task — only the print action can', async () => {
    const message = await makeMessage()
    const task = await createTask({
      facilityId,
      type: 'no_reachable_channel',
      entityType: 'Tenant',
      entityId: tenantId,
      priority: 'high',
    })

    // B-166's gate, applied to this type by B-318. "Called them" typed into a
    // note is the same sentence the task already contains.
    const refused = await completeTask(manager(), task.id, { note: 'Called them.' })
    expect(refused.ok).toBe(false)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('open')

    const printed = await recordLetterPrinted(manager(), message.id)
    expect(printed).toEqual({ ok: true, taskClosed: true })

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(after.status).toBe('completed')
    expect(after.completedByStaffId).toBe(staffId)
    expect(String((after.proof as { note?: string })?.note)).toContain('Letter printed for mailing')

    // A reprint months later must not read as closing something.
    expect(await recordLetterPrinted(manager(), message.id)).toEqual({ ok: true, taskClosed: false })
  })

  it('refuses to record a letter that was never composed', async () => {
    const message = await makeMessage({ body: '' })
    const task = await createTask({
      facilityId,
      type: 'no_reachable_channel',
      entityType: 'Tenant',
      entityId: tenantId,
      priority: 'high',
    })

    const result = await recordLetterPrinted(manager(), message.id)
    expect(result).toMatchObject({ ok: false })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('open')
  })

  it('refuses to record a letter with no address of record', async () => {
    const other = await prisma.tenant.create({
      data: { firstName: 'No', lastName: `Address-${suffix}`, email: null, facilityId },
    })
    const message = await prisma.message.create({
      data: {
        idempotencyKey: `print-${suffix}-noaddr`,
        eventId: `event-${suffix}-noaddr`,
        ruleId: 'test-rule',
        templateKey: 'invoice_past_due',
        templateVersion: 3,
        classification: 'transactional',
        channel: 'email',
        recipientTenantId: other.id,
        facilityId,
        toAddress: '',
        subjectSnapshot: 'Your rent is past due',
        bodySnapshot: BODY,
        status: 'failed',
      },
    })

    const letter = await messageForPrint(manager(), message.id)
    expect(letter?.to).toMatchObject({ ok: false })

    const result = await recordLetterPrinted(manager(), message.id)
    expect(result).toMatchObject({ ok: false })
  })

  it('the message log reaches past the first page', async () => {
    for (let index = 0; index < 22; index += 1) {
      await makeMessage({ key: `page-${index}` })
    }

    const firstPage = await tenantProfile(manager(), tenantId)
    expect(firstPage.messages).toHaveLength(20)

    const second = await tenantProfile(manager(), tenantId, 40)
    expect(second.messages).toHaveLength(22)
    // The 21st row exists and carries a body to print — which is the whole
    // point of reaching past the cap.
    expect(second.messages[20]?.bodySnapshot).toBe(BODY)
  })
})
