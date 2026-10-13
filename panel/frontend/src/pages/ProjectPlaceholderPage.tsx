import { useParams } from 'react-router-dom'

export function ProjectPlaceholderPage() {
  const { slug } = useParams<{ slug: string }>()

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Project</h1>
        <p className="font-mono text-sm text-muted-foreground">{slug ?? 'unknown'}</p>
      </div>
    </div>
  )
}
