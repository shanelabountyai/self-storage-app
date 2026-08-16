import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { base32Decode, totpCode, totpStep } from '../packages/core/auth/totp'
import {
  beginEnrollment,
  confirmEnrollment,
  mfaStatus,
  needsMfaEnrollment,
  pendingEnrollment,
  regenerateRecoveryCodes,
  verifySecondFactor,
} from '../apps/web/lib/auth/mfa'
import { decryptTotpSecret, encryptTotpSecret } from '../apps/web/lib/auth/totp-secret'
import { authenticateWithPassword, setPassword } from '../apps/web/lib/auth/accounts'
import { requestMagicLink } from '../apps/web/lib/auth/flows'
import { resetStaffMfa, staffSecurityRows } from '../apps/web/lib/admin/staff-security'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-079 / PRD 00 §7.1, against real rows. tests/totp.test.ts already proves the
// algorithm against the RFC vectors; this proves the things only a database can
// show — that a code cannot be spent twice, that a failed second factor counts
// against the login throttle, and that the secret is not sitting in a column in
// the clear.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const PASSWORD = 'correct-horse-battery-staple'

let staffId = ''
let staffEmail = ''
let otherStaffId = ''
let adminId = ''

function ownerActor(staffUserId: string): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        // Null facilityId is the all-facilities grant, which is what
        // `users:manage` asked org-wide requires.
        facilityId: null,
        roleKey: 'owner',
        rank: 40,
        permissions: new Set<PermissionKey>(['users:manage'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

/// Enrols and returns the decoded secret, so a test can generate codes.
async function enrol(staffUserId: string): Promise<Uint8Array> {
  const offer = await beginEnrollment(staffUserId)
  if ('error' in offer) throw new Error('unexpectedly already enrolled')
  const secret = base32Decode(offer.secret)
  const result = await confirmEnrollment(staffUserId, totpCode(secret, Date.now()))
  expect(result.ok).toBe(true)
  return secret
}

describeDb('staff MFA (PRD 00 §7.1)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `mfa-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    staffEmail = staff.email
    await setPassword(staffId, 'staff', PASSWORD)

    const other = await prisma.staffUser.create({
      data: { email: `mfa-o-${suffix}@example.com`, firstName: 'Otto', lastName: 'Other' },
    })
    otherStaffId = other.id

    const admin = await prisma.staffUser.create({
      data: { email: `mfa-a-${suffix}@example.com`, firstName: 'Ada', lastName: 'Admin' },
    })
    adminId = admin.id
  })

  beforeEach(async () => {
    // Reset both accounts to unenrolled between tests. Recovery codes cascade
    // from the staff row, but the row itself must survive — it is referenced
    // from the append-only audit log, which cannot be cleaned.
    await prisma.staffRecoveryCode.deleteMany({
      where: { staffUserId: { in: [staffId, otherStaffId] } },
    })
    await prisma.staffUser.updateMany({
      where: { id: { in: [staffId, otherStaffId] } },
      data: { totpSecret: null, totpConfirmedAt: null, totpLastStep: null },
    })
    await prisma.loginAttempt.deleteMany({ where: { email: staffEmail } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.staffRecoveryCode.deleteMany({
      where: { staffUserId: { in: [staffId, otherStaffId, adminId] } },
    })
    await prisma.loginAttempt.deleteMany({ where: { email: staffEmail } })
    // Staff rows stay: `audit_log` is append-only and references them.
  })

  describe('enrolment', () => {
    it('is not complete until a code proves the app works', async () => {
      const offer = await beginEnrollment(staffId)
      if ('error' in offer) throw new Error('unexpected')

      // A secret exists, but the account is NOT enrolled — this is the whole
      // point of the two-step: somebody who cannot produce a code has not
      // locked themselves out of anything.
      expect((await mfaStatus(staffId)).enrolled).toBe(false)
      expect((await mfaStatus(staffId)).pending).toBe(true)

      const bad = await confirmEnrollment(staffId, '000000')
      expect(bad).toEqual({ ok: false, reason: 'bad_code' })
      expect((await mfaStatus(staffId)).enrolled).toBe(false)

      const good = await confirmEnrollment(staffId, totpCode(base32Decode(offer.secret), Date.now()))
      expect(good.ok).toBe(true)
      expect((await mfaStatus(staffId)).enrolled).toBe(true)
    })

    it('issues ten recovery codes on confirmation', async () => {
      await enrol(staffId)
      expect((await mfaStatus(staffId)).unusedRecoveryCodes).toBe(10)
    })

    it('never stores the secret in the clear', async () => {
      const offer = await beginEnrollment(staffId)
      if ('error' in offer) throw new Error('unexpected')

      const row = await prisma.staffUser.findUniqueOrThrow({
        where: { id: staffId },
        select: { totpSecret: true },
      })
      // A database dump is the threat this answers: a plaintext secret would
      // let its holder mint a valid second factor for every staff account.
      expect(row.totpSecret).not.toContain(offer.secret)
      expect(row.totpSecret).toMatch(/^v1\./)
      expect(decryptTotpSecret(row.totpSecret!)).toBe(offer.secret)
    })

    it('re-shows the same pending secret rather than issuing a new one', async () => {
      const offer = await beginEnrollment(staffId)
      if ('error' in offer) throw new Error('unexpected')

      // Reloading the setup page must not silently invalidate the entry the
      // person already made in their authenticator.
      expect((await pendingEnrollment(staffId))?.secret).toBe(offer.secret)
    })

    it('refuses to re-key an account that is already enrolled', async () => {
      await enrol(staffId)
      expect(await beginEnrollment(staffId)).toEqual({ error: 'already_enrolled' })
    })
  })

  describe('verification', () => {
    it('accepts a current code and then refuses the same one', async () => {
      const secret = await enrol(staffId)
      // Enrolment itself consumed the current step, so the replay guard is
      // already armed against it.
      const code = totpCode(secret, Date.now())
      expect(await verifySecondFactor(staffId, code)).toEqual({ ok: false, reason: 'replayed' })

      const next = totpCode(secret, Date.now() + 30_000)
      expect(await verifySecondFactor(staffId, next)).toEqual({ ok: true, usedRecoveryCode: false })
      expect(await verifySecondFactor(staffId, next)).toEqual({ ok: false, reason: 'replayed' })
    })

    it('records the step it accepted', async () => {
      const secret = await enrol(staffId)
      // One step ahead, not two: the drift window is ±1, and a code from two
      // windows out is correctly refused (tests/totp.test.ts pins that).
      const at = Date.now() + 30_000
      const accepted = await verifySecondFactor(staffId, totpCode(secret, at))
      expect(accepted).toEqual({ ok: true, usedRecoveryCode: false })

      const row = await prisma.staffUser.findUniqueOrThrow({
        where: { id: staffId },
        select: { totpLastStep: true },
      })
      expect(row.totpLastStep).toBe(totpStep(at))
    })

    it('spends a recovery code exactly once', async () => {
      const offer = await beginEnrollment(staffId)
      if ('error' in offer) throw new Error('unexpected')
      const confirmed = await confirmEnrollment(
        staffId,
        totpCode(base32Decode(offer.secret), Date.now()),
      )
      if (!confirmed.ok) throw new Error('enrolment failed')

      const [code] = confirmed.recoveryCodes
      expect(await verifySecondFactor(staffId, code)).toEqual({ ok: true, usedRecoveryCode: true })
      expect(await verifySecondFactor(staffId, code)).toEqual({ ok: false, reason: 'invalid' })
      expect((await mfaStatus(staffId)).unusedRecoveryCodes).toBe(9)
    })

    it('will not spend somebody else’s recovery code', async () => {
      const offer = await beginEnrollment(staffId)
      if ('error' in offer) throw new Error('unexpected')
      const confirmed = await confirmEnrollment(
        staffId,
        totpCode(base32Decode(offer.secret), Date.now()),
      )
      if (!confirmed.ok) throw new Error('enrolment failed')

      await enrol(otherStaffId)
      // The hash is globally unique, so the staffUserId in the predicate is
      // what stops one person's code working on another's account.
      expect(await verifySecondFactor(otherStaffId, confirmed.recoveryCodes[0])).toEqual({
        ok: false,
        reason: 'invalid',
      })
      expect((await mfaStatus(staffId)).unusedRecoveryCodes).toBe(10)
    })

    it('invalidates every old code when new ones are issued', async () => {
      const offer = await beginEnrollment(staffId)
      if ('error' in offer) throw new Error('unexpected')
      const confirmed = await confirmEnrollment(
        staffId,
        totpCode(base32Decode(offer.secret), Date.now()),
      )
      if (!confirmed.ok) throw new Error('enrolment failed')

      const fresh = await regenerateRecoveryCodes(staffId)
      expect(fresh).toHaveLength(10)
      expect(await verifySecondFactor(staffId, confirmed.recoveryCodes[0])).toEqual({
        ok: false,
        reason: 'invalid',
      })
      expect((await verifySecondFactor(staffId, fresh[0])).ok).toBe(true)
    })

    it('fails closed when the secret cannot be decrypted', async () => {
      const secret = await enrol(staffId)
      const code = totpCode(secret, Date.now() + 30_000)

      // What a rotated AUTH_SECRET looks like from here. Treating this as "no
      // second factor configured" would turn a key rotation into a silent MFA
      // bypass across every staff account at once.
      await prisma.staffUser.update({
        where: { id: staffId },
        data: { totpSecret: 'v1.aaaa.bbbb.cccc' },
      })
      expect(await verifySecondFactor(staffId, code)).toEqual({ ok: false, reason: 'invalid' })
    })
  })

  describe('the login path', () => {
    it('refuses a correct password with no code once enrolled', async () => {
      await enrol(staffId)
      expect(await authenticateWithPassword(staffEmail, PASSWORD, 'staff')).toBeNull()
    })

    it('accepts a correct password with a current code', async () => {
      const secret = await enrol(staffId)
      const subject = await authenticateWithPassword(
        staffEmail,
        PASSWORD,
        'staff',
        null,
        totpCode(secret, Date.now() + 30_000),
      )
      expect(subject?.id).toBe(staffId)
    })

    it('lets an unenrolled staff member in, and the admin gate catches them', async () => {
      // Blocking the sign-in would leave a new hire with no way to ever enrol.
      expect((await authenticateWithPassword(staffEmail, PASSWORD, 'staff'))?.id).toBe(staffId)
      expect(await needsMfaEnrollment(staffId)).toBe(true)

      await enrol(staffId)
      expect(await needsMfaEnrollment(staffId)).toBe(false)
    })

    it('counts a failed second factor against the login throttle', async () => {
      await enrol(staffId)
      await authenticateWithPassword(staffEmail, PASSWORD, 'staff', null, '000000')

      const attempts = await prisma.loginAttempt.findMany({ where: { email: staffEmail } })
      // Without this the second factor is unthrottled: a correct password would
      // record a SUCCESS and clear the counter on every attempt, leaving a
      // six-digit code free to brute-force.
      expect(attempts).toHaveLength(1)
      expect(attempts[0].succeeded).toBe(false)
    })

    it('does not require a code from a tenant', async () => {
      const tenant = await prisma.tenant.create({
        data: { email: `mfa-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
      })
      await setPassword(tenant.id, 'tenant', PASSWORD)
      expect((await authenticateWithPassword(tenant.email, PASSWORD, 'tenant'))?.id).toBe(tenant.id)
      await prisma.loginAttempt.deleteMany({ where: { email: tenant.email } })
      await prisma.tenant.delete({ where: { id: tenant.id } })
    })

    it('will not mint a magic link for staff', async () => {
      // A link that signs somebody in on possession of their inbox is exactly
      // the second factor the password path now demands.
      await requestMagicLink(staffEmail, 'staff')
      const tokens = await prisma.authToken.findMany({
        where: { subjectId: staffId, purpose: 'magic_link' },
      })
      expect(tokens).toHaveLength(0)
    })
  })

  describe('administrative reset', () => {
    it('clears the second factor and every recovery code', async () => {
      await enrol(staffId)
      const result = await resetStaffMfa(ownerActor(adminId), {
        staffUserId: staffId,
        reasonCode: 'lost phone, confirmed by video call',
      })
      expect(result).toEqual({ ok: true })

      const status = await mfaStatus(staffId)
      expect(status.enrolled).toBe(false)
      expect(status.unusedRecoveryCodes).toBe(0)
      expect(await needsMfaEnrollment(staffId)).toBe(true)
    })

    it('is audited with the reason', async () => {
      await enrol(staffId)
      await resetStaffMfa(ownerActor(adminId), {
        staffUserId: staffId,
        reasonCode: 'lost phone, confirmed by video call',
      })

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'mfa.reset_by_admin', entityId: staffId },
        orderBy: { occurredAt: 'desc' },
      })
      expect(entry?.reasonCode).toBe('lost phone, confirmed by video call')
      expect(entry?.actorStaffId).toBe(adminId)
    })

    it('refuses to reset your own', async () => {
      // A one-click way to strip MFA off the account you are already signed in
      // to is the first thing somebody with a stolen session would use.
      await enrol(adminId)
      expect(
        await resetStaffMfa(ownerActor(adminId), { staffUserId: adminId, reasonCode: 'because' }),
      ).toEqual({ ok: false, reason: 'self' })
      expect((await mfaStatus(adminId)).enrolled).toBe(true)
      await prisma.staffRecoveryCode.deleteMany({ where: { staffUserId: adminId } })
      await prisma.staffUser.update({
        where: { id: adminId },
        data: { totpSecret: null, totpConfirmedAt: null, totpLastStep: null },
      })
    })

    it('shows enrolment status on the staff security list', async () => {
      await enrol(staffId)
      const rows = await staffSecurityRows(ownerActor(adminId))
      const row = rows.find((candidate) => candidate.staffUserId === staffId)
      expect(row?.enrolled).toBe(true)
      expect(row?.unusedRecoveryCodes).toBe(10)
    })
  })

  describe('secret encryption', () => {
    it('round-trips', () => {
      expect(decryptTotpSecret(encryptTotpSecret('MZXW6YTBOI'))).toBe('MZXW6YTBOI')
    })

    it('is different every time, so two enrolments never look alike', () => {
      // A deterministic ciphertext would let anyone with the column see which
      // two accounts share a secret — and would leak that a reset changed
      // nothing if it had not.
      expect(encryptTotpSecret('MZXW6YTBOI')).not.toBe(encryptTotpSecret('MZXW6YTBOI'))
    })

    it('returns null rather than garbage when the ciphertext is tampered with', () => {
      const stored = encryptTotpSecret('MZXW6YTBOI')
      const parts = stored.split('.')
      // Flipped in the MIDDLE, not at the end: base64url's last character can
      // carry unused bits, so changing it may decode to the very same bytes and
      // prove nothing. GCM's auth tag is what makes a genuine change detectable
      // rather than a plausible-looking wrong secret.
      const flipped = parts[3][0] === 'A' ? 'B' + parts[3].slice(1) : 'A' + parts[3].slice(1)
      expect(decryptTotpSecret([parts[0], parts[1], parts[2], flipped].join('.'))).toBeNull()
      expect(decryptTotpSecret('not-a-ciphertext')).toBeNull()
    })
  })
})
