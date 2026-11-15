import { Cube } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'

export const PRODUCT_NAME = 'VPS Control Panel'

const markSizes = {
  sm: { box: 'size-8 rounded-lg', icon: 'size-4' },
  md: { box: 'size-10 rounded-xl', icon: 'size-5' },
} as const

export type ProductLogoSize = 'sm' | 'md'
export type ProductLogoNamePlacement = 'beside' | 'below'

export interface ProductLogoProps {
  size?: ProductLogoSize
  showName?: boolean | ProductLogoNamePlacement
  className?: string
  nameClassName?: string
}

export function ProductLogo({
  size = 'sm',
  showName = false,
  className,
  nameClassName,
}: ProductLogoProps) {
  const placement: ProductLogoNamePlacement | null =
    showName === true ? 'beside' : showName === false ? null : showName
  const { box, icon } = markSizes[size]

  const mark = (
    <span
      className={cn('flex shrink-0 items-center justify-center bg-accent text-accent-foreground', box)}
      aria-hidden={placement ? true : undefined}
    >
      <Cube weight="fill" aria-hidden className={icon} />
    </span>
  )

  if (!placement) {
    return (
      <span className={className} aria-label={PRODUCT_NAME}>
        {mark}
      </span>
    )
  }

  const name = (
    <span className={cn('text-[18px] font-semibold tracking-tight', nameClassName)}>{PRODUCT_NAME}</span>
  )

  return (
    <span
      className={cn(
        'flex items-center',
        placement === 'below' ? 'flex-col gap-3 text-center' : 'gap-2.5',
        className,
      )}
    >
      {mark}
      {name}
    </span>
  )
}