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
    <div className={cn('overflow-x-auto rounded-xl bg-card shadow-card', className)} {...props}>
      {children}
    </div>
  )
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full min-w-full border-collapse text-[15px]', className)} {...props} />
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
      className={cn(
        'border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-accent-soft/45',
        className,
      )}
      {...props}
    />
  )
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 text-base text-foreground', className)} {...props} />
}