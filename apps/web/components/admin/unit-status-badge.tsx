import { unitStatusLabel } from '@storage/core/labels'
import { cn } from '@/lib/utils'

// PRD 02 US-5 AC fixes the colour per status. Colour is never the only signal:
// each badge also carries its label, and `unrentable` gets a hatch pattern
// (its AC-specified treatment) so the six states stay distinguishable without
// relying on hue — WCAG 2.1 AA, 1.4.1 Use of Colour.
const STATUS_STYLES: Record<string, string> = {
  available: 'bg-success-bg text-success-fg ring-success-border/30',
  occupied: 'bg-blue-100 text-blue-900 ring-blue-600/30 dark:bg-blue-950 dark:text-blue-100',
  reserved: 'bg-warning-bg text-warning-fg ring-warning-border/30',
  overlocked: 'bg-danger-bg text-danger-fg ring-danger-border/30',
  maintenance: 'bg-gray-200 text-gray-900 ring-gray-500/30 dark:bg-gray-800 dark:text-gray-100',
  unrentable:
    'bg-gray-100 text-gray-700 ring-gray-500/30 dark:bg-gray-900 dark:text-gray-300 ' +
    '[background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.12)_4px,rgba(0,0,0,0.12)_8px)]',
}

export function UnitStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        // No `capitalize`: the label arrives already written for a reader, and
        // a CSS transform cannot turn `pending_auction` into "Pending auction".
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-900 ring-gray-500/30',
        className,
      )}
    >
      {unitStatusLabel(status)}
    </span>
  )
}

export const UNIT_STATUS_STYLES = STATUS_STYLES
