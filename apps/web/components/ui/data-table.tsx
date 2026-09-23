import * as React from 'react'

import { cn } from '@/lib/utils'

// B-384. The kit's table chrome as classes on the native elements, so every
// existing <caption>, <th scope> and ScrollRegion wrapper stays exactly as
// written: `<DataTable>` is a <table>, `DataTable.Head` a tinted <thead>, and
// rows hover. No sorting, no virtual rows: neither exists in the kit's data.
export function DataTable({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full text-left text-sm', className)} {...props} />
}
DataTable.Head = function Head({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('bg-muted text-muted-foreground text-xs font-semibold uppercase', className)}
      {...props}
    />
  )
}
DataTable.Row = function Row({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-border hover:bg-muted/50 h-11 border-b', className)} {...props} />
}
