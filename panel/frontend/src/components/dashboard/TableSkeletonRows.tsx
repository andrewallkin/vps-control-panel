import { Skeleton, TR, TD } from '../ui'

export function TableSkeletonRows({
  columns,
  rows = 4,
}: {
  columns: number
  rows?: number
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <TR key={rowIndex} className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, colIndex) => (
            <TD key={colIndex} className="py-2.5">
              <Skeleton className="h-4 w-full max-w-[8rem]" />
            </TD>
          ))}
        </TR>
      ))}
      <span className="sr-only">Loading…</span>
    </>
  )
}
