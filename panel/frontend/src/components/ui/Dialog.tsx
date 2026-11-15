import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from '@phosphor-icons/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

export function DialogOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/25 backdrop-blur-sm', className)}
      {...props}
    />
  )
}

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  busy?: boolean
  showClose?: boolean
}

export function DialogContent({
  className,
  children,
  busy = false,
  showClose = false,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: DialogContentProps) {
  const preventWhenBusy = (event: Event) => {
    if (busy) {
      event.preventDefault()
    }
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-5 shadow-popover outline-none',
          className,
        )}
        onEscapeKeyDown={(event) => {
          preventWhenBusy(event)
          onEscapeKeyDown?.(event)
        }}
        onPointerDownOutside={(event) => {
          preventWhenBusy(event)
          onPointerDownOutside?.(event)
        }}
        onInteractOutside={(event) => {
          preventWhenBusy(event)
          onInteractOutside?.(event)
        }}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-xl p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="Close"
            disabled={busy}
          >
            <X weight="bold" aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-2 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('mt-4 flex flex-wrap justify-end gap-2', className)}>{children}</div>
  )
}