import { DotsThree, Gear, Plus, Trash } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  buttonClasses,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  ProductLogo,
  Select,
  Skeleton,
  Spinner,
  Switch,
  Table,
  useToast,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '../components/ui'

export function UiShowcasePage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tab, setTab] = useState('one')
  const [enabled, setEnabled] = useState(true)
  const { toast } = useToast()

  return (
    <div className="min-h-dvh bg-background px-6 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-12">
        <PageHeader
          title="Studio UI kit"
          description="Dev-only showcase for the light Studio foundation — warm canvas, indigo accent, 16px+ body type, and white cards."
          actions={
            <Link className={buttonClasses({ variant: 'secondary' })} to="/">
              Back to app
            </Link>
          }
        />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Buttons</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm" leftIcon={<Plus weight="bold" className="size-4" aria-hidden />}>
              With icon
            </Button>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Product logo</h2>
          <Card>
            <CardBody className="flex flex-wrap items-center gap-10 py-6">
              <ProductLogo size="sm" showName nameClassName="tracking-tight text-foreground" />
              <ProductLogo size="md" showName="beside" nameClassName="tracking-tight text-foreground" />
              <ProductLogo size="md" showName="below" nameClassName="tracking-tight text-foreground" />
            </CardBody>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Icon button</h2>
          <IconButton label="Settings">
            <Gear weight="bold" className="size-5" aria-hidden />
          </IconButton>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Form controls</h2>
          <div className="grid max-w-md gap-4">
            <Field label="Project name" hint="Lowercase slug is derived automatically.">
              {(props) => <Input {...props} placeholder="my-app" />}
            </Field>
            <Field label="Replica count" error="Must be at least 1">
              {(props) => <Input {...props} mono defaultValue="0" />}
            </Field>
            <Textarea placeholder="Notes" />
            <Field label="Timezone">
              {(props) => (
                <Select defaultValue="utc" {...props}>
                  <option value="utc">UTC</option>
                  <option value="local">Local</option>
                </Select>
              )}
            </Field>
            <label className="flex items-center gap-2 text-base">
              <Checkbox defaultChecked />
              Enable automatic backups
            </label>
            <Switch checked={enabled} onCheckedChange={setEnabled} label="High availability" />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Card</h2>
          <Card>
            <CardHeader title="nginx" description="Reverse proxy · 2 replicas" actions={<Badge tone="success" dot>Running</Badge>} />
            <CardBody>
              <p className="text-base text-muted-foreground">Card body content on a white Studio surface.</p>
            </CardBody>
            <CardFooter>
              <Button variant="secondary" size="sm">View logs</Button>
            </CardFooter>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Tabs</h2>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="one">Overview</TabsTrigger>
              <TabsTrigger value="two">Environment</TabsTrigger>
            </TabsList>
            <TabsContent value="one">Overview panel</TabsContent>
            <TabsContent value="two">Environment panel</TabsContent>
          </Tabs>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Dialog</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Example dialog</DialogTitle>
              <DialogDescription>Backdrop blur and popover shadow.</DialogDescription>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setDialogOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Badges</h2>
          <div className="flex flex-wrap gap-2">
            {(['neutral', 'success', 'warning', 'danger', 'info'] as const).map((tone) => (
              <Badge key={tone} tone={tone} dot>
                {tone}
              </Badge>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Alerts</h2>
          <div className="space-y-2">
            <Alert tone="info" title="Info">Deployment queued.</Alert>
            <Alert tone="success" title="Success">DNS propagated.</Alert>
            <Alert tone="warning" title="Warning">Certificate expires soon.</Alert>
            <Alert tone="danger" title="Error">Health check failed.</Alert>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Empty state</h2>
          <Card>
            <EmptyState
              icon={<Gear weight="duotone" className="size-10" aria-hidden />}
              title="No projects yet"
              description="Create a project to deploy your first stack."
              action={<Button leftIcon={<Plus weight="bold" className="size-4" aria-hidden />}>New project</Button>}
            />
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Loading</h2>
          <div className="flex items-center gap-4">
            <Spinner />
            <Skeleton className="h-9 w-48" />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Table</h2>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Service</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD>api</TD>
                  <TD>
                    <Badge tone="success" dot>Up</Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>worker</TD>
                  <TD>
                    <Badge tone="warning" dot>Degraded</Badge>
                  </TD>
                </TR>
              </TBody>
            </Table>
          </TableContainer>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Toasts</h2>
          <div className="flex flex-wrap gap-2">
            {(['success', 'danger', 'info', 'warning'] as const).map((tone) => (
              <Button
                key={tone}
                variant="secondary"
                size="sm"
                onClick={() =>
                  toast({
                    tone,
                    title: `${tone.charAt(0).toUpperCase()}${tone.slice(1)} toast`,
                    description: 'Optional detail text for the notification.',
                  })
                }
              >
                Show {tone}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Terminal log</h2>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-5 py-3">
              <span className="text-base font-medium text-foreground">Live job log</span>
              <span className="text-sm text-muted-foreground">Restore job · streaming</span>
            </div>
            <pre className="max-h-52 overflow-auto bg-zinc-950 p-5 font-mono text-sm leading-relaxed text-zinc-200">
              {`14:32:01 ▸ Pulling image ghcr.io/example/api:v2.4.1
14:32:08 ✓ Image pulled (142 MB)
14:32:14 ✓ Migrations applied
14:32:49 Deploy succeeded in 48s
— Waiting for events…`}
            </pre>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Dropdown</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" rightIcon={<DotsThree weight="bold" className="size-4" aria-hidden />}>
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem icon={<Gear weight="regular" className="size-4" aria-hidden />}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem tone="danger" icon={<Trash weight="regular" className="size-4" aria-hidden />}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>
      </div>
    </div>
  )
}
