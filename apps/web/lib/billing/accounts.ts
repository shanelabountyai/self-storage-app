import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 01 §9 Phase 3 (B-090 part 5). Business accounts with consolidated
// billing: the payer above the lease.
//
// The schema note on `BillingAccount` carries the design; the short version is
// that nothing about an Invoice changes. An account decides two things and no
// others: whose one payment settles which leases' invoices, and what a screen
// adds up before it shows a total.

/// Every lease a payment by this tenant, at this facility, may settle.
///
/// **This is the whole of what an account does to the money path**, and it is
/// one `where` fragment on purpose: `claimsFor` and `coveredByPlan` in
/// `allocation.ts` are the only two readers, so the counter, the portal, a pay
/// link and autopay all inherit it without knowing accounts exist.
///
/// A UNION, never a swap. A tenant's own leases stay claimable whatever else
/// they pay for — a company director who also rents a personal 5×5 can still
/// walk in and pay for it — and a lease on an account is claimable by the payer
/// as well as by its own tenant, because the tenant handing over cash at the
/// counter for their own unit must not be refused because their employer
/// usually pays.
export function payableLeaseFilter(
  tenantId: string,
  facilityId: string,
): Prisma.LeaseWhereInput {
  return {
    facilityId,
    OR: [{ tenantId }, { billingAccount: { payerTenantId: tenantId } }],
  }
}

export type AccountLease = {
  leaseId: string
  unitNumber: string
  tenantName: string
  monthlyRateCents: number
  balanceCents: number
}

export type AccountSummary = {
  id: string
  name: string
  payerTenantId: string
  payerName: string
  payerEmail: string
  leaseCount: number
  monthlyRateCents: number
  balanceCents: number
}

const NAME_MAX = 120

/// Balances for a set of leases, keyed by lease, from the ledger.
///
/// The same aggregate the portal reads (`owingLeases`) rather than a second
/// way of adding up money: a consolidated total that disagreed with the per-lease
/// figures on the same screen would be worse than no total at all.
async function balancesFor(
  leaseIds: readonly string[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, number>> {
  if (leaseIds.length === 0) return new Map()
  const rows = await client.ledgerEntry.groupBy({
    by: ['leaseId'],
    where: { leaseId: { in: [...leaseIds] } },
    _sum: { amountCents: true },
  })
  return new Map(rows.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))
}

function assertMayManage(actor: Actor, facilityId: string): void {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'billing_accounts:manage', facilityId)) {
    throw new ForbiddenError('billing_accounts:manage')
  }
}

export class AccountError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'AccountError'
    this.field = field
  }
}

/// Every account at a facility, with what it owes.
export async function accountsFor(
  actor: Actor,
  facilityId: string,
): Promise<AccountSummary[]> {
  assertFacilityAccess(actor, facilityId)
  const accounts = await prisma.billingAccount.findMany({
    where: { facilityId },
    select: {
      id: true,
      name: true,
      payerTenantId: true,
      payer: { select: { firstName: true, lastName: true, email: true } },
      leases: {
        where: { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
        select: { id: true, monthlyRateCents: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  const balances = await balancesFor(
    accounts.flatMap((account) => account.leases.map((lease) => lease.id)),
  )

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    payerTenantId: account.payerTenantId,
    payerName: `${account.payer.firstName} ${account.payer.lastName}`,
    payerEmail: account.payer.email,
    leaseCount: account.leases.length,
    monthlyRateCents: account.leases.reduce((sum, lease) => sum + lease.monthlyRateCents, 0),
    balanceCents: account.leases.reduce(
      (sum, lease) => sum + (balances.get(lease.id) ?? 0),
      0,
    ),
  }))
}

export type AccountDetail = AccountSummary & {
  facilityId: string
  facilityName: string
  leases: AccountLease[]
}

export async function accountDetail(
  actor: Actor,
  accountId: string,
): Promise<AccountDetail | null> {
  const account = await prisma.billingAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      facilityId: true,
      facility: { select: { name: true } },
      payerTenantId: true,
      payer: { select: { firstName: true, lastName: true, email: true } },
      leases: {
        where: { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
        select: {
          id: true,
          monthlyRateCents: true,
          unit: { select: { number: true } },
          tenant: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
  if (!account) return null
  assertFacilityAccess(actor, account.facilityId)

  const balances = await balancesFor(account.leases.map((lease) => lease.id))
  const leases: AccountLease[] = account.leases
    .map((lease) => ({
      leaseId: lease.id,
      unitNumber: lease.unit.number,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      monthlyRateCents: lease.monthlyRateCents,
      balanceCents: balances.get(lease.id) ?? 0,
    }))
    .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }))

  return {
    id: account.id,
    name: account.name,
    facilityId: account.facilityId,
    facilityName: account.facility.name,
    payerTenantId: account.payerTenantId,
    payerName: `${account.payer.firstName} ${account.payer.lastName}`,
    payerEmail: account.payer.email,
    leaseCount: leases.length,
    monthlyRateCents: leases.reduce((sum, lease) => sum + lease.monthlyRateCents, 0),
    balanceCents: leases.reduce((sum, lease) => sum + lease.balanceCents, 0),
    leases,
  }
}

export async function createAccount(
  actor: Actor,
  input: { facilityId: string; name: string; payerEmail: string },
): Promise<{ id: string; name: string }> {
  assertMayManage(actor, input.facilityId)

  const name = input.name.trim()
  if (name.length === 0) throw new AccountError('name', 'Enter a name for the account.')
  if (name.length > NAME_MAX) {
    throw new AccountError('name', `Keep the name to ${NAME_MAX} characters or fewer.`)
  }

  const email = input.payerEmail.trim().toLowerCase()
  const payer = await prisma.tenant.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  })
  // The payer has to be an existing tenant record. Creating one from this form
  // would mint an identity that can sign in and see other people's balances,
  // which is a move-in's job and not this screen's.
  if (!payer || payer.deletedAt) {
    throw new AccountError(
      'payerEmail',
      `No tenant here has the email ${email}. Add them as a tenant first, then create the account.`,
    )
  }

  const duplicate = await prisma.billingAccount.findUnique({
    where: { facilityId_name: { facilityId: input.facilityId, name } },
    select: { id: true },
  })
  if (duplicate) {
    throw new AccountError('name', `This facility already has an account called "${name}".`)
  }

  const created = await prisma.billingAccount.create({
    data: { facilityId: input.facilityId, name, payerTenantId: payer.id },
    select: { id: true, name: true },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'billing_account.created',
    entityType: 'BillingAccount',
    entityId: created.id,
    facilityId: input.facilityId,
    context: { name, payerTenantId: payer.id, payerEmail: email },
  })

  return created
}

/// Puts a lease on an account, so the account's payer settles it.
///
/// Refuses a lease that is already on another account rather than moving it:
/// silently re-pointing who pays for a unit is the one change on this screen
/// that a person would not notice having made.
export async function attachLease(
  actor: Actor,
  input: { accountId: string; unitNumber: string },
): Promise<{ leaseId: string; unitNumber: string }> {
  const account = await prisma.billingAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true, facilityId: true },
  })
  if (!account) throw new AccountError('unitNumber', 'That account no longer exists.')
  assertMayManage(actor, account.facilityId)

  const unitNumber = input.unitNumber.trim()
  if (unitNumber.length === 0) throw new AccountError('unitNumber', 'Enter a unit number.')

  const leases = await prisma.lease.findMany({
    where: {
      facilityId: account.facilityId,
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
      unit: { number: unitNumber },
    },
    select: {
      id: true,
      billingAccountId: true,
      billingAccount: { select: { name: true } },
      unit: { select: { number: true } },
    },
  })

  if (leases.length === 0) {
    throw new AccountError(
      'unitNumber',
      `No occupied unit ${unitNumber} at this facility. Check the number on the tenant's lease.`,
    )
  }
  // A unit number is unique per facility, so more than one occupying lease on
  // it is a data problem rather than a choice to offer.
  if (leases.length > 1) {
    throw new AccountError(
      'unitNumber',
      `Unit ${unitNumber} has ${leases.length} open leases. Sort that out before setting a payer.`,
    )
  }

  const lease = leases[0]
  if (lease.billingAccountId === account.id) {
    throw new AccountError('unitNumber', `Unit ${unitNumber} is already on this account.`)
  }
  if (lease.billingAccountId) {
    throw new AccountError(
      'unitNumber',
      `Unit ${unitNumber} is paid for by "${lease.billingAccount?.name}". Take it off that account first.`,
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.lease.update({
      where: { id: lease.id },
      data: { billingAccountId: account.id },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'billing_account.lease_attached',
        entityType: 'Lease',
        entityId: lease.id,
        facilityId: account.facilityId,
        context: { accountId: account.id, accountName: account.name, unitNumber },
      },
      tx,
    )
  })

  return { leaseId: lease.id, unitNumber }
}

export async function detachLease(
  actor: Actor,
  input: { accountId: string; leaseId: string },
): Promise<{ unitNumber: string }> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: {
      id: true,
      facilityId: true,
      billingAccountId: true,
      billingAccount: { select: { name: true } },
      unit: { select: { number: true } },
    },
  })
  if (!lease || lease.billingAccountId !== input.accountId) {
    throw new AccountError('leaseId', 'That unit is no longer on this account.')
  }
  assertMayManage(actor, lease.facilityId)

  await prisma.$transaction(async (tx) => {
    await tx.lease.update({ where: { id: lease.id }, data: { billingAccountId: null } })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'billing_account.lease_detached',
        entityType: 'Lease',
        entityId: lease.id,
        facilityId: lease.facilityId,
        context: {
          accountId: input.accountId,
          accountName: lease.billingAccount?.name ?? null,
          unitNumber: lease.unit.number,
        },
      },
      tx,
    )
  })

  return { unitNumber: lease.unit.number }
}
