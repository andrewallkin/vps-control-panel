export function PanelHostnameHint({ fqdn }: { fqdn: string }) {
  return (
    <p className="mt-1 text-xs">
      <span className="text-muted-foreground">Panel hostname </span>
      <span className="font-mono">{fqdn}</span>
    </p>
  )
}
