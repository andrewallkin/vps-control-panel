import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[10rem] rounded-xl border border-border bg-card p-1 shadow-popover outline-none',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export interface DropdownMenuItemProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  icon?: ReactNode
  tone?: 'default' | 'danger'
}

export function DropdownMenuItem({
  className,
  icon,
  tone = 'default',
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none',
        'data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
        tone === 'danger' && 'text-destructive data-[highlighted]:bg-destructive-soft',
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      {children}
    </DropdownMenuPrimitive.Item>
  )
}