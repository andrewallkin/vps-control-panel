import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface TableContainerProps extends HTMLAttributes<HTMLDivElement> {
  contained?: boolean
}

export function TableContainer({ contained = true, className, children, ...props }: TableContainerProps) {
  if (!contained) {
    return <>{children}</>
  }
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-border', className)} {...props}>
      {children}
    </div>
  )
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full min-w-full border-collapse text-sm', className)} {...props} />
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-muted/50', className)}
      {...props}
    />
  )
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2.5 text-foreground', className)} {...props} />
}