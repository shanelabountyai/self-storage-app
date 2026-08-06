import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  previewTemplate,
  saveTemplateVersion,
  templatesFor,
} from '../apps/web/lib/admin/templates'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-053 / PRD 05 CN-16. The editor against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
const KEY = 'invoice_due_soon'

function actor(permissions: string[] = ['facility:settings']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('template editor', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Template Test',
        slug: `template-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `template-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
  })

  afterEach(async () => {
    // Only this facility's overrides — the org defaults are seeded data every
    // other suite reads.
    await prisma.messageTemplate.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.messageTemplate.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('lists the org defaults a facility inherits', async () => {
    const templates = await templatesFor(actor(), facilityId)
    const due = templates.find((template) => template.key === KEY)
    expect(due).toBeTruthy()
    expect(due!.isOverride).toBe(false)
    expect(due!.event).toBe('invoice.due_soon')
  })

  it('previews through the same renderer a real send uses', async () => {
    const preview = await previewTemplate(actor(), facilityId, {
      key: KEY,
      subject: 'Rent for unit {{unit.number}}',
      bodyText: 'Hi {{tenant.first_name}}, {{invoice.amount}} is due.',
      requiredMergeFields: ['tenant.first_name', 'invoice.amount', 'unit.number'],
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) throw new Error('unreachable')
    // Sample values, so the operator reads a sentence rather than placeholders.
    expect(preview.subject).toContain('A-12')
    expect(preview.text).toContain('$129.00')
    // CN-17's footer is part of what the tenant receives, so the preview shows it.
    expect(preview.text).toContain('Austin, TX 78704')
  })

  it('reports a preview that would fail at send time rather than faking it', async () => {
    const preview = await previewTemplate(actor(), facilityId, {
      key: KEY,
      subject: 'Hi',
      bodyText: 'Hi {{tenant.first_name}}',
      requiredMergeFields: ['balance.total'],
    })
    expect(preview.ok).toBe(false)
    if (preview.ok) throw new Error('unreachable')
    expect(preview.missing).toContain('balance.total')
  })

  it('refuses to publish a field the event cannot supply', async () => {
    const result = await saveTemplateVersion(actor(), facilityId, {
      key: KEY,
      subject: 'Rent',
      bodyText: 'Hi {{tenant.middle_name}}',
      requiredMergeFields: [],
      scope: 'facility',
    })
    expect(result).toMatchObject({ ok: false, problem: 'unknown_fields' })
    if (result.ok) throw new Error('unreachable')
    expect(result.unknown).toEqual(['tenant.middle_name'])
    expect(await prisma.messageTemplate.count({ where: { facilityId } })).toBe(0)
  })

  it('refuses an empty body', async () => {
    expect(
      await saveTemplateVersion(actor(), facilityId, {
        key: KEY,
        subject: 'x',
        bodyText: '   ',
        requiredMergeFields: [],
        scope: 'facility',
      }),
    ).toMatchObject({ ok: false, problem: 'empty' })
  })

  it('publishes a facility override without touching the org default', async () => {
    const before = await prisma.messageTemplate.findFirstOrThrow({
      where: { key: KEY, facilityId: null, active: true },
    })

    const result = await saveTemplateVersion(actor(), facilityId, {
      key: KEY,
      subject: 'Rent for {{unit.number}}',
      bodyText: 'Hi {{tenant.first_name}} — our own wording.',
      requiredMergeFields: ['tenant.first_name', 'unit.number'],
      scope: 'facility',
    })
    expect(result).toMatchObject({ ok: true, version: 1 })

    const after = await prisma.messageTemplate.findFirstOrThrow({
      where: { key: KEY, facilityId: null, active: true },
    })
    // The shared default is untouched — an override is an addition.
    expect(after.id).toBe(before.id)
    expect(after.bodyText).toBe(before.bodyText)

    const listed = (await templatesFor(actor(), facilityId)).find((t) => t.key === KEY)
    expect(listed!.isOverride).toBe(true)
    expect(listed!.bodyText).toContain('our own wording')
  })

  it('is append-only — a second save is a new version, and the old one survives', async () => {
    await saveTemplateVersion(actor(), facilityId, {
      key: KEY,
      subject: 'First',
      bodyText: 'Hi {{tenant.first_name}} v1',
      requiredMergeFields: ['tenant.first_name'],
      scope: 'facility',
    })
    const second = await saveTemplateVersion(actor(), facilityId, {
      key: KEY,
      subject: 'Second',
      bodyText: 'Hi {{tenant.first_name}} v2',
      requiredMergeFields: ['tenant.first_name'],
      scope: 'facility',
    })
    expect(second).toMatchObject({ ok: true, version: 2 })

    const rows = await prisma.messageTemplate.findMany({
      where: { key: KEY, facilityId },
      orderBy: { version: 'asc' },
    })
    // Both versions exist; only the newest is active. A Message that recorded
    // version 1 can still be reproduced exactly as it was sent.
    expect(rows.map((row) => [row.version, row.active])).toEqual([
      [1, false],
      [2, true],
    ])
  })

  it('audits the publish with its version and scope', async () => {
    const result = await saveTemplateVersion(actor(), facilityId, {
      key: KEY,
      subject: 'Audited',
      bodyText: 'Hi {{tenant.first_name}}',
      requiredMergeFields: ['tenant.first_name'],
      scope: 'facility',
    })
    if (!result.ok) throw new Error('unreachable')

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'template.published', entityId: KEY, facilityId },
      orderBy: { occurredAt: 'desc' },
    })
    expect((audit.after as { version: number; scope: string })).toMatchObject({
      version: result.version,
      scope: 'facility',
    })
  })

  it('refuses a staffer without facility:settings', async () => {
    await expect(
      templatesFor(actor(['tenants:view']), facilityId),
    ).rejects.toThrow()
  })
})
