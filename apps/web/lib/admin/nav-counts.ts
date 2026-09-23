import { prisma } from '@storage/db'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { NAV_ITEMS } from './nav'

/// B-386. Open-work counts for the sidebar, keyed by nav item key. Only the
/// three items with a real queue behind them get one, and only when the actor
/// can see that item (nav.ts's own `anyOf`), so a count never costs a query for
/// a link that is not rendered. Zero is left out: a "0" badge is noise.
///
/// Delinquency and Walkthrough count OPEN tasks of the types those screens
/// list (the same filters `delinquencyQueue` and `walkthroughRollup` use);
/// Rate Increases counts batches waiting on approval, as its roll-up does.
export async function navCounts(actor: Actor, facilityIds: readonly string[]): Promise<Record<string, number>> {
  if (facilityIds.length === 0) return {}
  const visible = (key: string) => {
    const anyOf = NAV_ITEMS.find((item) => item.key === key)?.anyOf
    return !anyOf || hasPermissionAnywhere(actor, anyOf)
  }
  const inScope = { facilityId: { in: [...facilityIds] } }

  const [delinquency, walkthrough, rateIncreases] = await Promise.all([
    visible('delinquency')
      ? prisma.task.count({
          where: { ...inScope, status: 'open', type: { in: ['overlock_apply', 'overlock_remove', 'delinquency_step'] } },
        })
      : 0,
    visible('walkthrough')
      ? prisma.task.count({ where: { ...inScope, status: 'open', type: 'daily_walkthrough' } })
      : 0,
    visible('rate-increases')
      ? prisma.tenantRateIncrease.count({ where: { ...inScope, status: 'pending_approval' } })
      : 0,
  ])

  const counts = { delinquency, walkthrough, 'rate-increases': rateIncreases }
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0))
}
