import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { processCommsEvent, retryDeferredSmsMessages, suppress } from '../apps/web/lib/comms/service'
import {
  applySmsStart,
  applySmsStop,
  beginSmsOptIn,
  confirmSmsOptIn,
} from '../apps/web/lib/comms/sms-consent'
import * as provider from '../apps/web/lib/comms/provider'

// B-074 / PRD 05 FR-5/FR-7/FR-8/CN-13/CN-14, against real rows and the real
// seeded catalog (`payment_method.expiring` / `payment_method_expiring`).
//
// The properties worth a database: SMS actually sends when every condition
// holds, each condition's absence falls back to email rather than dropping
// the message (FR-7), quiet hours defer rather than fall back (FR-8) and the
// cron sweep resolves them, and STOP/START actually change what the next
// send sees.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const slug = `sms-${suffix}`

let facilityId = ''

const emailSends: { to: string; subject: string; body: string }[] = []
const smsSends: { to: string; body: string; messagingServiceSid: string }[] = []

function fakeEmailProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      emailSends.push({ to: email.to, subject: email.subject ?? '', body: email.text ?? '' })
      return { ok: true, providerMessageId: `test_email_${emailSends.length}` }
    },
  }
}

function fakeSmsProvider(): provider.SmsProvider {
  return {
    name: 'test',
    async sendSms(sms) {
      smsSends.push({ to: sms.to, body: sms.body, messagingServiceSid: sms.messagingServiceSid })
      return { ok: true, providerMessageId: `test_sms_${smsSends.length}` }
    },
  }
}

let tenantCounter = 0
function nextEmail(): string {
  tenantCounter += 1
  return `sms-${suffix}-${tenantCounter}@example.com`
}
function nextPhone(): string {
  tenantCounter += 1
  // Distinct last-10-digits per tenant, valid US shape.
  return `512555${String(1000 + tenantCounter).slice(-4)}`
}

async function makeTenant(overrides: { phone?: string | null; consent?: boolean } = {}) {
  const tenant = await prisma.tenant.create({
    data: {
      email: nextEmail(),
      firstName: 'Ada',
      lastName: 'Renter',
      phone: overrides.phone === undefined ? nextPhone() : overrides.phone,
    },
  })
  if (overrides.consent !== false) {
    await prisma.consent.create({
      data: { tenantId: tenant.id, channel: 'account_sms', state: 'granted', source: 'checkout_step_1' },
    })
  }
  return tenant
}

const T0 = new Date('2026-07-01T18:00:00.000Z') // 1pm America/Chicago — inside the default window

async function raisePaymentMethodExpiring(tenantId: string, at: Date = T0) {
  const event = await prisma.domainEvent.create({
    data: {
      name: 'payment_method.expiring',
      entityType: 'Tenant',
      entityId: tenantId,
      facilityId,
      payload: { expMonth: 11, expYear: 2026, stage: 30 },
      occurredAt: at,
    },
  })
  return processCommsEvent(event, at)
}

describeDb('SMS delivery (FR-5/FR-7/FR-8)', () => {
  beforeAll(async () => {
    // Defensive: `retryDeferredSmsMessages` sweeps ALL facilities by design
    // (that is the real, correct production behaviour), so a stray facility
    // + deferred message left behind by a previous run that was killed
    // mid-test (before its own `afterAll` ran) would otherwise get swept up
    // by THIS run's sweep test and inflate its count. Cheap to just clear
    // anything this suite's own naming convention left behind before it
    // creates its own fixture.
    const stray = await prisma.facility.findMany({
      where: { slug: { startsWith: 'sms-' } },
      select: { id: true },
    })
    if (stray.length > 0) {
      const strayIds = stray.map((f) => f.id)
      await prisma.message.deleteMany({ where: { facilityId: { in: strayIds } } })
      await prisma.domainEvent.deleteMany({ where: { facilityId: { in: strayIds } } })
      await prisma.facility.deleteMany({ where: { id: { in: strayIds } } })
    }

    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeEmailProvider())
    vi.spyOn(provider, 'selectSmsProvider').mockImplementation(() => fakeSmsProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)
    vi.spyOn(provider, 'effectiveSmsRecipient').mockImplementation((phone: string) => phone)

    const facility = await prisma.facility.create({
      data: {
        name: `SMS Test ${suffix}`,
        slug,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        smsMessagingServiceSid: 'MG00000000000000000000000000000a',
      },
    })
    facilityId = facility.id
  })

  afterEach(async () => {
    emailSends.length = 0
    smsSends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.consent.deleteMany({ where: { tenant: { email: { contains: suffix } } } })
    await prisma.notificationPreference.deleteMany({ where: { tenant: { email: { contains: suffix } } } })
    await prisma.suppression.deleteMany({ where: { address: { contains: '512555' } } })
    await prisma.suppression.deleteMany({ where: { address: { contains: suffix } } })
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.facility.update({
      where: { id: facilityId },
      data: { smsMessagingServiceSid: 'MG00000000000000000000000000000a', smsQuietHoursStartHour: 8, smsQuietHoursEndHour: 21 },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('sends by SMS when consent, phone and messaging service all hold', async () => {
    const tenant = await makeTenant()
    const result = await raisePaymentMethodExpiring(tenant.id)

    expect(result.sent).toBe(1)
    expect(smsSends).toHaveLength(1)
    expect(emailSends).toEqual([])
    expect(smsSends[0].body).toContain('11/2026')
    expect(smsSends[0].body).toMatch(/Reply STOP to opt out, HELP for help\.$/)

    const message = await prisma.message.findFirst({ where: { facilityId, templateKey: 'payment_method_expiring' } })
    expect(message).toMatchObject({ status: 'sent', channel: 'sms' })
    expect(message?.consentId).toBeTruthy()
  })

  it('falls back to email with no SMS consent — "no consent, no SMS"', async () => {
    const tenant = await makeTenant({ consent: false })
    const result = await raisePaymentMethodExpiring(tenant.id)

    expect(result.sent).toBe(1)
    expect(smsSends).toEqual([])
    expect(emailSends).toHaveLength(1)
    expect(emailSends[0].to).toBe(tenant.email)

    const message = await prisma.message.findFirst({ where: { facilityId, templateKey: 'payment_method_expiring' } })
    expect(message?.channel).toBe('email')
  })

  it('falls back to email when the facility has no messaging service configured', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { smsMessagingServiceSid: null } })
    const tenant = await makeTenant()
    const result = await raisePaymentMethodExpiring(tenant.id)

    expect(result.sent).toBe(1)
    expect(smsSends).toEqual([])
    expect(emailSends).toHaveLength(1)
  })

  it('falls back to email when the phone on file does not normalize', async () => {
    const tenant = await makeTenant({ phone: 'call the office' })
    const result = await raisePaymentMethodExpiring(tenant.id)

    expect(result.sent).toBe(1)
    expect(smsSends).toEqual([])
    expect(emailSends).toHaveLength(1)
  })

  it('falls back to email when the number has opted out (STOP)', async () => {
    const tenant = await makeTenant()
    await suppress({ channel: 'sms', address: `+1${tenant.phone}`, reason: 'stop', note: 'test' })

    const result = await raisePaymentMethodExpiring(tenant.id)
    expect(result.sent).toBe(1)
    expect(smsSends).toEqual([])
    expect(emailSends).toHaveLength(1)
  })

  it('a genuine dead end (no phone, email suppressed) reaches neither channel', async () => {
    const tenant = await makeTenant({ phone: null })
    await suppress({ channel: 'email', address: tenant.email.toLowerCase(), reason: 'hard_bounce', note: 'test' })

    const result = await raisePaymentMethodExpiring(tenant.id)
    expect(result.suppressed).toBe(1)
    expect(smsSends).toEqual([])
    expect(emailSends).toEqual([])

    const message = await prisma.message.findFirst({ where: { facilityId, templateKey: 'payment_method_expiring' } })
    expect(message).toMatchObject({ status: 'suppressed', suppressionReason: 'hard_bounce' })
  })

  it('defers rather than falling back during quiet hours (FR-8)', async () => {
    const tenant = await makeTenant()
    // T0 is 1pm Central; push quiet hours to exclude it entirely.
    await prisma.facility.update({
      where: { id: facilityId },
      data: { smsQuietHoursStartHour: 14, smsQuietHoursEndHour: 15 },
    })

    const result = await raisePaymentMethodExpiring(tenant.id)
    expect(result.deferred).toBe(1)
    expect(smsSends).toEqual([])
    expect(emailSends).toEqual([]) // NOT a fallback trigger — this one waits.

    const message = await prisma.message.findFirst({ where: { facilityId, templateKey: 'payment_method_expiring' } })
    expect(message?.status).toBe('deferred')
  })

  it('the cron sweep resends a deferred message once the window reopens', async () => {
    const tenant = await makeTenant()
    await prisma.facility.update({
      where: { id: facilityId },
      data: { smsQuietHoursStartHour: 14, smsQuietHoursEndHour: 15 },
    })
    await raisePaymentMethodExpiring(tenant.id)
    expect(smsSends).toEqual([])

    // Re-open the window and sweep.
    await prisma.facility.update({
      where: { id: facilityId },
      data: { smsQuietHoursStartHour: 8, smsQuietHoursEndHour: 21 },
    })
    const swept = await retryDeferredSmsMessages(T0)
    expect(swept.retried).toBe(1)
    expect(smsSends).toHaveLength(1)

    const message = await prisma.message.findFirst({ where: { facilityId, templateKey: 'payment_method_expiring' } })
    expect(message?.status).toBe('sent')
  })

  it('the cron sweep leaves a message deferred while still inside quiet hours', async () => {
    const tenant = await makeTenant()
    await prisma.facility.update({
      where: { id: facilityId },
      data: { smsQuietHoursStartHour: 14, smsQuietHoursEndHour: 15 },
    })
    await raisePaymentMethodExpiring(tenant.id)

    const swept = await retryDeferredSmsMessages(T0)
    expect(swept.retried).toBe(0)
    expect(swept.stillQuiet).toBe(1)
    expect(smsSends).toEqual([])
  })

  describe('the preference center (CN-13)', () => {
    it('falls back to email when the tenant turned SMS off for this category', async () => {
      const tenant = await makeTenant()
      await prisma.notificationPreference.create({
        data: { tenantId: tenant.id, category: 'payment_reminders', channel: 'sms', enabled: false },
      })

      const result = await raisePaymentMethodExpiring(tenant.id)
      expect(result.sent).toBe(1)
      expect(smsSends).toEqual([])
      expect(emailSends).toHaveLength(1)
    })

    it('sends nothing when the tenant turned off BOTH channels for this category', async () => {
      const tenant = await makeTenant()
      await prisma.notificationPreference.createMany({
        data: [
          { tenantId: tenant.id, category: 'payment_reminders', channel: 'sms', enabled: false },
          { tenantId: tenant.id, category: 'payment_reminders', channel: 'email', enabled: false },
        ],
      })

      const result = await raisePaymentMethodExpiring(tenant.id)
      expect(result.cancelled).toBe(1)
      expect(smsSends).toEqual([])
      expect(emailSends).toEqual([])
    })
  })

  describe('STOP / START (CN-14)', () => {
    it('applySmsStop suppresses the number and revokes account_sms consent', async () => {
      const tenant = await makeTenant()
      const e164 = `+1${tenant.phone}`

      const result = await applySmsStop({ rawPhone: e164, source: 'sms_stop_keyword' })
      expect(result).toEqual({ suppressed: true, tenantMatched: true })

      const suppression = await prisma.suppression.findUnique({
        where: { channel_address: { channel: 'sms', address: e164 } },
      })
      expect(suppression?.reason).toBe('stop')

      const consent = await prisma.consent.findFirst({
        where: { tenantId: tenant.id, channel: 'account_sms' },
        orderBy: { capturedAt: 'desc' },
      })
      expect(consent?.state).toBe('revoked')
    })

    it('a STOP-ed number falls back to email on the next send', async () => {
      const tenant = await makeTenant()
      await applySmsStop({ rawPhone: `+1${tenant.phone}`, source: 'sms_stop_keyword', tenantId: tenant.id })

      const result = await raisePaymentMethodExpiring(tenant.id)
      expect(result.sent).toBe(1)
      expect(smsSends).toEqual([])
      expect(emailSends).toHaveLength(1)
    })

    it('applySmsStart lifts the suppression and re-grants consent', async () => {
      const tenant = await makeTenant()
      const e164 = `+1${tenant.phone}`
      await applySmsStop({ rawPhone: e164, source: 'sms_stop_keyword', tenantId: tenant.id })

      const result = await applySmsStart({ rawPhone: e164 })
      expect(result.lifted).toBe(true)

      expect(
        await prisma.suppression.findUnique({ where: { channel_address: { channel: 'sms', address: e164 } } }),
      ).toBeNull()

      const consent = await prisma.consent.findFirst({
        where: { tenantId: tenant.id, channel: 'account_sms' },
        orderBy: { capturedAt: 'desc' },
      })
      expect(consent?.state).toBe('granted')
    })

    it('opts a KNOWN number in for the first time, with nothing to lift', async () => {
      // The text-based opt-in an A2P 10DLC campaign declares as its consent
      // method. Before this, START only undid a previous STOP — so a tenant who
      // gave us their number at move-in and never switched texts on could text
      // JOIN all day and stay unsubscribed.
      const tenant = await makeTenant()
      const result = await applySmsStart({ rawPhone: `+1${tenant.phone}` })

      expect(result.lifted).toBe(false)
      expect(result.optedIn).toBe(true)

      const consent = await prisma.consent.findFirst({
        where: { tenantId: tenant.id, channel: 'account_sms' },
        orderBy: { capturedAt: 'desc' },
      })
      expect(consent?.state).toBe('granted')
      expect(consent?.source).toBe('sms_start_keyword')
    })

    it('JOIN alone subscribes nobody — it only asks for confirmation', async () => {
      // The whole difference between a two-step opt-in and a one-step one
      // wearing an extra message, and the step a campaign review asks to see.
      const tenant = await makeTenant()
      const result = await beginSmsOptIn({ rawPhone: `+1${tenant.phone}` })
      expect(result).toEqual({ ok: true, step: 'awaiting_confirmation' })

      const consent = await prisma.consent.findFirst({
        where: { tenantId: tenant.id, channel: 'account_sms' },
        orderBy: { capturedAt: 'desc' },
      })
      expect(consent?.state).toBe('pending')
    })

    it('YES after JOIN completes the opt-in', async () => {
      const tenant = await makeTenant()
      await beginSmsOptIn({ rawPhone: `+1${tenant.phone}` })
      expect(await confirmSmsOptIn({ rawPhone: `+1${tenant.phone}` })).toEqual({
        ok: true,
        step: 'confirmed',
      })

      const consent = await prisma.consent.findFirst({
        where: { tenantId: tenant.id, channel: 'account_sms' },
        orderBy: { capturedAt: 'desc' },
      })
      expect(consent?.state).toBe('granted')
      expect(consent?.source).toBe('sms_double_opt_in')
    })

    it('a bare YES with nothing pending subscribes nobody', async () => {
      // Otherwise the second step is theatre, and "they replied YES" is
      // evidence of nothing.
      const tenant = await makeTenant()
      expect(await confirmSmsOptIn({ rawPhone: `+1${tenant.phone}` })).toEqual({
        ok: false,
        reason: 'nothing_pending',
      })
      // The fixture tenant already has a consent row; what matters is that the
      // bare YES wrote nothing of its own.
      expect(
        await prisma.consent.count({
          where: { tenantId: tenant.id, channel: 'account_sms', source: 'sms_double_opt_in' },
        }),
      ).toBe(0)
    })

    it('will not begin an opt-in for a number it cannot place', async () => {
      expect(await beginSmsOptIn({ rawPhone: `+1${nextPhone()}` })).toEqual({
        ok: false,
        reason: 'unknown_number',
      })
    })

    it('does NOT subscribe a number it cannot place', async () => {
      // Confirming a subscription here would be the worst possible reply: it is
      // the message a carrier audit reads as proof of consent, and there would
      // be no consent behind it.
      const result = await applySmsStart({ rawPhone: `+1${nextPhone()}` })
      expect(result).toEqual({ lifted: false, tenantMatched: false, optedIn: false })
    })

    it('a manual suppression is untouched by START — only a stop-reason entry lifts', async () => {
      const phone = `+1${nextPhone()}`
      await suppress({ channel: 'sms', address: phone, reason: 'manual', note: 'staff added' })

      const result = await applySmsStart({ rawPhone: phone })
      expect(result.lifted).toBe(false)
      expect(
        (await prisma.suppression.findUnique({ where: { channel_address: { channel: 'sms', address: phone } } }))
          ?.reason,
      ).toBe('manual')
    })
  })

  // ── D-51 (B-123): the marketing SMS lane ────────────────────────────────
  //
  // These build their OWN rule rather than using a seeded one, and that is the
  // point rather than a convenience: D-51 ships the lane dark, so no seeded
  // rule dispatches marketing SMS. The gate still has to be provably correct
  // before one ever does, and a test rule is how you prove that without
  // shipping a live campaign.
  describe('marketing SMS (D-51)', () => {
    const MARKETING_EVENT = 'lead.drip_due'
    // A template of this suite's own rather than a seeded one.
    //
    // The catalog's marketing SMS bodies require `lead.quoted_price` and
    // friends, which do not resolve for a bare Tenant-entity event — a render
    // failure would fail these tests for a reason that has nothing to do with
    // the consent lane they exist to check. Merge-field resolution has its own
    // tests; this one is about the gate.
    const MARKETING_TEMPLATE = `marketing_sms_gate_${suffix}`
    let ruleId = ''
    let templateId = ''

    async function makeMarketingTemplate() {
      const template = await prisma.messageTemplate.create({
        data: {
          key: MARKETING_TEMPLATE,
          channel: 'sms',
          classification: 'marketing',
          facilityId,
          bodyText: 'A promotion you agreed to hear about.',
          requiredMergeFields: [],
        },
      })
      templateId = template.id
    }

    async function makeMarketingRule() {
      await makeMarketingTemplate()
      const rule = await prisma.notificationRule.create({
        data: {
          event: MARKETING_EVENT,
          templateKey: MARKETING_TEMPLATE,
          channel: 'sms',
          channelPolicy: 'sms_only',
          classification: 'marketing',
          skipConditions: [],
          facilityId,
        },
      })
      ruleId = rule.id
      return rule
    }

    async function raiseMarketing(tenantId: string, at: Date = T0) {
      const event = await prisma.domainEvent.create({
        data: {
          name: MARKETING_EVENT,
          entityType: 'Tenant',
          entityId: tenantId,
          facilityId,
          payload: {},
          occurredAt: at,
        },
      })
      return processCommsEvent(event, at)
    }

    afterEach(async () => {
      if (ruleId) {
        await prisma.notificationRule.deleteMany({ where: { id: ruleId } })
        ruleId = ''
      }
      if (templateId) {
        await prisma.messageTemplate.deleteMany({ where: { id: templateId } })
        templateId = ''
      }
    })

    it('refuses a marketing SMS to a tenant who only granted account_sms', async () => {
      // THE trap the row named: "a promo sent down the transactional lane
      // because the marketing lane does not exist." Before B-123 the gate
      // checked `account_sms` for every classification, so this tenant — who
      // agreed to gate codes and nothing else — would have been sent a promo.
      await makeMarketingRule()
      const tenant = await makeTenant() // account_sms granted, marketing_sms absent

      const result = await raiseMarketing(tenant.id)

      expect(smsSends).toEqual([])
      expect(result.sent).toBe(0)
      const message = await prisma.message.findFirst({
        where: { facilityId, templateKey: MARKETING_TEMPLATE },
      })
      expect(message?.status).toBe('failed')
      expect(message?.error).toBe('no sms consent')
    })

    it('sends when marketing_sms is granted', async () => {
      await makeMarketingRule()
      const tenant = await makeTenant()
      await prisma.consent.create({
        data: {
          tenantId: tenant.id,
          channel: 'marketing_sms',
          state: 'granted',
          source: 'checkout_step_1',
          disclosureVersion: 'v1-draft',
        },
      })

      const result = await raiseMarketing(tenant.id)

      expect(result.sent).toBe(1)
      expect(smsSends).toHaveLength(1)
      // FR-11's opt-out line is appended to marketing texts too, not just
      // transactional ones — on this lane it is the STOP the disclosure promised.
      expect(smsSends[0].body).toMatch(/Reply STOP to opt out, HELP for help\.$/)
    })

    it('does not treat marketing_sms as permission to send transactional, or vice versa', async () => {
      // The lanes are independent in BOTH directions. A tenant who agreed only
      // to promotions has not agreed to gate codes by text either.
      const tenant = await makeTenant({ consent: false })
      await prisma.consent.create({
        data: { tenantId: tenant.id, channel: 'marketing_sms', state: 'granted', source: 'checkout_step_1' },
      })

      const result = await raisePaymentMethodExpiring(tenant.id)

      expect(smsSends).toEqual([])
      // `payment_method_expiring` is sms_preferred_email_fallback, so the
      // transactional message correctly falls back to email rather than dying.
      expect(result.sent).toBe(1)
      expect(emailSends).toHaveLength(1)
    })

    it('never falls back to email when the marketing SMS cannot be sent', async () => {
      // `sendEmailFallback` skips the marketing quiet-hours, daily-cap and
      // unsubscribe-link branches AND the marketing_email consent check, so a
      // fallback here would deliver a marketing email that passed none of the
      // marketing gates to somebody who never consented to marketing email.
      await makeMarketingTemplate()
      await prisma.notificationRule.create({
        data: {
          event: MARKETING_EVENT,
          templateKey: MARKETING_TEMPLATE,
          channel: 'sms',
          // The policy that WOULD fall back, asked for explicitly.
          channelPolicy: 'sms_preferred_email_fallback',
          classification: 'marketing',
          skipConditions: [],
          facilityId,
        },
      }).then((rule) => { ruleId = rule.id })

      const tenant = await makeTenant() // no marketing_sms consent
      const result = await raiseMarketing(tenant.id)

      expect(smsSends).toEqual([])
      expect(emailSends).toEqual([])
      expect(result.sent).toBe(0)
    })

    it('applies the once-a-day marketing cap to texts', async () => {
      // FR-MSG-5 across sequences. Without this a tenant on both lanes could
      // receive one marketing email and one marketing text in the same day and
      // both would report themselves compliant.
      await makeMarketingRule()
      const tenant = await makeTenant()
      await prisma.consent.create({
        data: { tenantId: tenant.id, channel: 'marketing_sms', state: 'granted', source: 'checkout_step_1' },
      })

      await raiseMarketing(tenant.id)
      expect(smsSends).toHaveLength(1)

      // A second campaign the same day, an hour later.
      const later = new Date(T0.getTime() + 3_600_000)
      await raiseMarketing(tenant.id, later)

      expect(smsSends).toHaveLength(1)
      const capped = await prisma.message.findFirst({
        where: { facilityId, templateKey: MARKETING_TEMPLATE, status: 'cancelled' },
      })
      expect(capped?.error).toBe('skipped: marketing_daily_cap')
    })

    it('still refuses after a STOP, even with marketing consent on file', async () => {
      // Suppression is address-keyed and global; consent is per-lane. A number
      // that texted STOP gets nothing, whatever any consent row says.
      await makeMarketingRule()
      const tenant = await makeTenant()
      await prisma.consent.create({
        data: { tenantId: tenant.id, channel: 'marketing_sms', state: 'granted', source: 'checkout_step_1' },
      })
      await applySmsStop({ rawPhone: tenant.phone!, source: 'sms_stop_keyword' })

      await raiseMarketing(tenant.id)

      expect(smsSends).toEqual([])
      const message = await prisma.message.findFirst({
        where: { facilityId, templateKey: MARKETING_TEMPLATE },
      })
      expect(message?.status).toBe('suppressed')
    })

    it('ships with no seeded rule that sends marketing SMS (D-51)', async () => {
      // The lane is built and dark. If a later item turns it on, this fails and
      // whoever did it has to come and read D-51 — which is the intent: the
      // blockers are legal review of the disclosure and a separate A2P 10DLC
      // marketing campaign, neither of which is a code change.
      const live = await prisma.notificationRule.findMany({
        where: { classification: 'marketing', channel: 'sms', facilityId: null },
        select: { event: true, templateKey: true },
      })
      expect(live).toEqual([])
    })
  })

})
