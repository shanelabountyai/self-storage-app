import type { AuditActor } from '@storage/core/audit'
import type { Actor } from './actor'

/// Bridges the RBAC actor to the audit package's own actor shape.
/// packages/core deliberately does not depend on apps/web, so the mapping
/// lives on this side of the boundary.
export function toAuditActor(actor: Actor): AuditActor {
  switch (actor.kind) {
    case 'staff':
      return { type: 'staff', staffUserId: actor.staffUserId }
    case 'tenant':
      return { type: 'tenant', tenantId: actor.tenantId }
    case 'system':
      return { type: 'system', label: actor.label }
  }
}
