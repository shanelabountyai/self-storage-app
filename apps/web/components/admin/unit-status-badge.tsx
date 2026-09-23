import { unitStatusLabel } from '@storage/core/labels'
import { cn } from '@/lib/utils'

// D-148: the kit's legend — vacant green, occupied grey, reserved blue, overdue
// red, maintenance amber (`--unit-*` tokens, PRD 02 US-5). Colour is never the
// only signal: every badge carries a dot AND its label, and `unrentable` gets a
// hatch pattern, so the states stay distinguishable without hue — WCAG 2.1 AA,
// 1.4.1 Use of Colour.
const DOT: Record<string, string> = {
  available: 'bg-unit-vacant',
  occupied: 'bg-unit-occupied',
  reserved: 'bg-unit-reserved',
  overlocked: 'bg-unit-overdue',
  maintenance: 'bg-unit-maintenance',
}
const STATUS_STYLES: Record<string, string> = {
  available: 'bg-unit-vacant-soft text-unit-vacant-fg ring-unit-vacant/40',
  occupied: 'bg-unit-occupied-soft text-unit-occupied-fg ring-unit-occupied/40',
  reserved: 'bg-unit-reserved-soft text-unit-reserved-fg ring-unit-reserved/40',
  overlocked: 'bg-unit-overdue-soft text-unit-overdue-fg ring-unit-overdue/40',
  maintenance: 'bg-unit-maintenance-soft text-unit-maintenance-fg ring-unit-maintenance/40',
  unrentable:
    'bg-card text-foreground ring-foreground/40 ' +
    '[background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.12)_4px,rgba(0,0,0,0.12)_8px)]',
}

export function UnitStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        // No `capitalize`: the label arrives already written for a reader, and
        // a CSS transform cannot turn `pending_auction` into "Pending auction".
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        STATUS_STYLES[status] ?? STATUS_STYLES.occupied,
        className,
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', DOT[status] ?? 'bg-foreground/60')} />
      {unitStatusLabel(status)}
    </span>
  )
}

export const UNIT_STATUS_STYLES = STATUS_STYLES
