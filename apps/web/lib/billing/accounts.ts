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
  return { facilityId, ...payableLeaseWhere(tenantId) }
}

/// The same union, with no facility on it.
///
/// B-256. The portal asks the question across every site a tenant touches —
/// "what may I pay", "which statements are mine" — where the money path always
/// asks it about one facility, because a `Payment` carries a facility and an
/// allocation order is per-facility. Extracted rather than copied so there is
/// still exactly ONE definition of what an account lets a tenant reach; a
/// second one that drifted would be a payer seeing units they cannot pay for,
/// or paying for units they cannot see.
export function payableLeaseWhere(tenantId: string): Prisma.LeaseWhereInput {
  return { OR: [{ tenantId }, { billingAccount: { payerTenantId: tenantId } }] }
}

/// **B-258 deliberately did not widen the fragment above.** An account's
/// authorized members can SEE the account and cannot pay it, so membership is a
/// fact about a read model (`portalAccountsFor`) rather than about the money
/// path. The invariant B-256 extracted this function to protect is intact and
/// is now a strict containment rather than an equality: everything payable is
/// visible, and the dangerous direction — paying for a unit you cannot see —
/// remains impossible by construction. A member who may pay would be a second
/// person able to move money on somebody else's account, which is an owner
/// decision and not a default.

export type AccountMember = {
  tenantId: string
  name: string
  email: string
  since: Date
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
  /// B-258. The people who may see this account without paying for it.
  members: AccountMember[]
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
      members: {
        select: {
          tenantId: true,
          createdAt: true,
          tenant: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
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
    members: account.members.map((member) => ({
      tenantId: member.tenantId,
      name: `${member.tenant.firstName} ${member.tenant.lastName}`,
      email: member.tenant.email,
      since: member.createdAt,
    })),
  }
}

/// The one rule both the payer field and the member field enforce: the person
/// has to be an existing tenant record already.
///
/// Creating one from either form would mint an identity that can sign in and
/// see other people's balances, which is a move-in's job and not this screen's.
///
/// **This is also where D-111 lands, and B-258 deliberately leaves it there.**
/// `Tenant.email` is required and unique, so two people sharing one household
/// address cannot both be tenants and therefore cannot both be members. That is
/// the same constraint that stops a husband and wife each having an account;
/// B-238 owns it, and a second answer invented here would be a second answer to
/// contradict.
async function existingTenantByEmail(
  raw: string,
  field: string,
  then: string,
): Promise<{ id: string; email: string }> {
  const email = raw.trim().toLowerCase()
  const tenant = await prisma.tenant.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  })
  if (!tenant || tenant.deletedAt) {
    throw new AccountError(
      field,
      `No tenant here has the email ${email}. Add them as a tenant first, then ${then}.`,
    )
  }
  return { id: tenant.id, email }
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

  const { id: payerId, email } = await existingTenantByEmail(
    input.payerEmail,
    'payerEmail',
    'create the account',
  )

  const duplicate = await prisma.billingAccount.findUnique({
    where: { facilityId_name: { facilityId: input.facilityId, name } },
    select: { id: true },
  })
  if (duplicate) {
    throw new AccountError('name', `This facility already has an account called "${name}".`)
  }

  const created = await prisma.billingAccount.create({
    data: { facilityId: input.facilityId, name, payerTenantId: payerId },
    select: { id: true, name: true },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'billing_account.created',
    entityType: 'BillingAccount',
    entityId: created.id,
    facilityId: input.facilityId,
    context: { name, payerTenantId: payerId, payerEmail: email },
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

/// B-258 / PRD 01 §12. Lets somebody SEE an account without making them pay it.
///
/// The office manager, the second director, the bookkeeper: until this existed
/// the only way to give any of them sight of the account was to make them its
/// payer, which is a money change made to solve a visibility problem — it moves
/// who the consolidated Pay button belongs to and who a receipt names.
///
/// **Look-only.** A member gets the account card and nothing that moves money;
/// see the note on `payableLeaseWhere`.
export async function addMember(
  actor: Actor,
  input: { accountId: string; email: string },
): Promise<{ tenantId: string; name: string }> {
  const account = await prisma.billingAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true, facilityId: true, payerTenantId: true },
  })
  if (!account) throw new AccountError('email', 'That account no longer exists.')
  assertMayManage(actor, account.facilityId)

  const { id: tenantId, email } = await existingTenantByEmail(
    input.email,
    'email',
    'add them here',
  )

  // The payer already sees the account, and rather more of it. Adding them
  // would leave a row that grants nothing and a list that implies it does.
  if (tenantId === account.payerTenantId) {
    throw new AccountError('email', `${email} is the payer, so they already see this account.`)
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { firstName: true, lastName: true },
  })
  const name = `${tenant.firstName} ${tenant.lastName}`

  const existing = await prisma.billingAccountMember.findUnique({
    where: { accountId_tenantId: { accountId: account.id, tenantId } },
    select: { id: true },
  })
  if (existing) {
    throw new AccountError('email', `${name} can already see this account.`)
  }

  await prisma.$transaction(async (tx) => {
    await tx.billingAccountMember.create({ data: { accountId: account.id, tenantId } })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'billing_account.member_added',
        entityType: 'BillingAccount',
        entityId: account.id,
        facilityId: account.facilityId,
        context: { accountName: account.name, tenantId, email },
      },
      tx,
    )
  })

  return { tenantId, name }
}

export async function removeMember(
  actor: Actor,
  input: { accountId: string; tenantId: string },
): Promise<{ name: string }> {
  const member = await prisma.billingAccountMember.findUnique({
    where: { accountId_tenantId: { accountId: input.accountId, tenantId: input.tenantId } },
    select: {
      account: { select: { id: true, name: true, facilityId: true } },
      tenant: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  if (!member) throw new AccountError('tenantId', 'That person no longer sees this account.')
  assertMayManage(actor, member.account.facilityId)

  const name = `${member.tenant.firstName} ${member.tenant.lastName}`
  await prisma.$transaction(async (tx) => {
    await tx.billingAccountMember.delete({
      where: { accountId_tenantId: { accountId: input.accountId, tenantId: input.tenantId } },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'billing_account.member_removed',
        entityType: 'BillingAccount',
        entityId: member.account.id,
        facilityId: member.account.facilityId,
        context: {
          accountName: member.account.name,
          tenantId: input.tenantId,
          email: member.tenant.email,
        },
      },
      tx,
    )
  })

  return { name }
}

/// B-256. What the payer sees in the portal: one card per account they pay for.
/// B-258. And what an authorized MEMBER sees: the same card, read-only.
///
/// A separate read model from `accountsFor`, which is a staff screen scoped by
/// facility and gated on `billing_accounts:manage`. This one is scoped by who
/// is signed in, spans every facility, and is reached by a tenant — so it takes
/// a `tenantId` rather than an `Actor` and there is no permission to check: the
/// two things that make an account visible are being its payer and being one of
/// its members, and both are facts about this tenant's own row.
///
/// **`payable` is the whole of the difference and every caller must read it.**
/// It is true only for the payer, and it gates the Pay button, the link into
/// the consolidated statement, and the renters' names — a member is one step
/// further from the money than the payer is, and the payer's disclosure is not
/// automatically theirs (see `tenantName`).
///
/// Occupying leases only by default — this feeds a Pay button, and a unit
/// somebody moved out of is not something to bill for.
///
/// `includeEndedLeases` is for the consolidated STATEMENT, which is the other
/// question and needs the other answer. A lease keeps its `billingAccountId`
/// when it ends (the relation is `Restrict` both ways, and nothing detaches on
/// move-out), and a month's account statement that silently dropped the unit
/// the company moved out of in April would be a bookkeeping document that
/// disagrees with the list it was reached from — which lists every month every
/// lease on the account has, ended ones included, deliberately
/// (`statementsForTenant`).
export type PortalAccount = {
  id: string
  name: string
  facilityId: string
  facilityName: string
  facilityPhone: string | null
  /// A ledger entry is an instant; the day it happened on is a facility-local
  /// day. Carried so the account's statement months line up with the per-unit
  /// ones (`monthBounds`).
  facilityTimezone: string
  units: AccountLease[]
  monthlyRateCents: number
  balanceCents: number
  /// B-258. True for the payer, false for a member. The Pay button, the
  /// statement link and the renters' names all hang off it.
  payable: boolean
  /// B-258. Who settles this account, so a member who cannot pay it is not left
  /// wondering who does. Always the account's payer, including on the payer's
  /// own card, where it is simply not rendered.
  payerName: string
}

export async function portalAccountsFor(
  tenantId: string,
  { includeEndedLeases = false }: { includeEndedLeases?: boolean } = {},
): Promise<PortalAccount[]> {
  const accounts = await prisma.billingAccount.findMany({
    where: {
      OR: [{ payerTenantId: tenantId }, { members: { some: { tenantId } } }],
    },
    select: {
      id: true,
      name: true,
      facilityId: true,
      payerTenantId: true,
      payer: { select: { firstName: true, lastName: true } },
      facility: { select: { name: true, phone: true, timezone: true } },
      leases: {
        where: includeEndedLeases ? {} : { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
        select: {
          id: true,
          monthlyRateCents: true,
          unit: { select: { number: true } },
          tenant: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const balances = await balancesFor(
    accounts.flatMap((account) => account.leases.map((lease) => lease.id)),
  )

  return accounts
    // An account with no units left is not a card worth drawing — it has no
    // total, nothing to pay and nothing to list. The account itself survives,
    // because the staff screen is where an empty one is dealt with.
    .filter((account) => account.leases.length > 0)
    .map((account) => {
      const payable = account.payerTenantId === tenantId
      const units: AccountLease[] = account.leases
        .map((lease) => ({
          leaseId: lease.id,
          unitNumber: lease.unit.number,
          // B-258. Empty for a member, and the card renders no column for it.
          // The payer is told whose unit their money settles because they are
          // settling it; a member was added to see what the account owes, and
          // the renters' names are not part of that answer. Widening it is an
          // owner decision, not a default.
          tenantName: payable ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : '',
          monthlyRateCents: lease.monthlyRateCents,
          balanceCents: balances.get(lease.id) ?? 0,
        }))
        .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }))

      return {
        id: account.id,
        name: account.name,
        facilityId: account.facilityId,
        facilityName: account.facility.name,
        facilityPhone: account.facility.phone,
        facilityTimezone: account.facility.timezone,
        units,
        monthlyRateCents: units.reduce((sum, unit) => sum + unit.monthlyRateCents, 0),
        balanceCents: units.reduce((sum, unit) => sum + unit.balanceCents, 0),
        payable,
        payerName: `${account.payer.firstName} ${account.payer.lastName}`,
      }
    })
}
