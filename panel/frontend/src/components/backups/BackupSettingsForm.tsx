import { CheckCircle, FileArrowUp, Spinner } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { StepUpDialog } from '../StepUpDialog'
import { isStepUpRequired } from '../../lib/api'
import {
  formatScheduleHours,
  parseScheduleHours,
  testBackupCredentials,
  updateBackupSettings,
  type BackupSettings,
  type BackupSettingsPut,
} from '../../lib/backupsApi'
import { filterTimeZones, listTimeZones } from '../../lib/timezones'

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour)

type PendingSave = BackupSettingsPut

type PassphraseAction = 'keep' | 'set' | 'clear'

export interface BackupSettingsFormProps {
  settings: BackupSettings
  idPrefix?: string
  showHeading?: boolean
  onSaved?: () => void
}

function PassphraseHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 cursor-pointer"
        aria-label="Dismiss dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-[min(40rem,calc(100dvh-2rem))] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold">
          What the archive passphrase does
        </h2>
        <div className="mt-3 space-y-4 text-sm text-muted-foreground">
          <p>
            When this is set, each backup uploads two age-encrypted files. Keep a copy of the
            passphrase off this server. The stack <span className="font-mono text-xs">.env</span>{' '}
            inside the config archive contains the passphrase, so that file cannot be your only
            copy. Losing the passphrase makes both files unreadable.
          </p>
          <div className="space-y-2">
            <p className="font-medium text-foreground">
              Database dump{' '}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                backup_….sql.gz.age
              </span>
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Every database in the PostgreSQL cluster.</li>
              <li>Application rows stored in those databases.</li>
              <li>Database role password hashes.</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">
              Config archive{' '}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                config_….tar.gz.age
              </span>
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Each app’s <span className="font-mono text-xs">.env</span>, including its secrets.
              </li>
              <li>
                Every file under each app’s <span className="font-mono text-xs">data</span>{' '}
                directory, such as uploaded files and local databases.
              </li>
              <li>
                The stack <span className="font-mono text-xs">.env</span>: database password, bucket
                settings, and this passphrase.
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Not included</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>App source code.</li>
              <li>The panel’s own data.</li>
              <li>Raw PostgreSQL files on disk. Database contents are in the dump instead.</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">With no passphrase</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                The dump is uploaded as a plain{' '}
                <span className="font-mono text-xs">backup_….sql.gz</span>.
              </li>
              <li>The config archive is not created.</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function isJsonServiceAccount(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

export function BackupSettingsForm({
  settings,
  idPrefix = 'backup',
  showHeading = true,
  onSaved,
}: BackupSettingsFormProps) {
  const queryClient = useQueryClient()
  const listId = useId()

  const [bucket, setBucket] = useState(settings.bucket)
  const [retentionDays, setRetentionDays] = useState(settings.retention_days)
  const [scheduleMinute, setScheduleMinute] = useState(settings.schedule_minute)
  const [scheduleHours, setScheduleHours] = useState(() =>
    parseScheduleHours(settings.schedule_hours),
  )
  const [timezone, setTimezone] = useState(settings.timezone)
  const [timezoneQuery, setTimezoneQuery] = useState(settings.timezone)
  const [serviceAccountDraft, setServiceAccountDraft] = useState('')
  const [replaceKeyOpen, setReplaceKeyOpen] = useState(!settings.credentials_configured)
  const [passphraseHelpOpen, setPassphraseHelpOpen] = useState(false)
  const closePassphraseHelp = useCallback(() => setPassphraseHelpOpen(false), [])
  const [passphraseAction, setPassphraseAction] = useState<PassphraseAction>('keep')
  const [passphraseDraft, setPassphraseDraft] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null)
  const [pendingTest, setPendingTest] = useState<{ service_account: string | null; bucket: string } | null>(
    null,
  )

  const allTimeZones = useMemo(() => listTimeZones(), [])
  const timezoneMatches = useMemo(
    () => filterTimeZones(timezoneQuery, allTimeZones),
    [allTimeZones, timezoneQuery],
  )

  const buildSavePayload = useCallback((): BackupSettingsPut => {
    const payload: BackupSettingsPut = {
      bucket: bucket.trim(),
      schedule_hours: formatScheduleHours(scheduleHours),
      schedule_minute: scheduleMinute,
      timezone: timezone.trim(),
      retention_days: retentionDays,
    }
    const keyText = serviceAccountDraft.trim()
    if (keyText) {
      payload.service_account = keyText
    } else if (replaceKeyOpen && !settings.credentials_configured) {
      // no key provided while required
    }
    if (passphraseAction === 'set' && passphraseDraft.trim()) {
      payload.archive_passphrase = passphraseDraft
    } else if (passphraseAction === 'clear') {
      payload.archive_passphrase = ''
    }
    return payload
  }, [
    bucket,
    retentionDays,
    scheduleHours,
    scheduleMinute,
    timezone,
    serviceAccountDraft,
    replaceKeyOpen,
    settings.credentials_configured,
    passphraseAction,
    passphraseDraft,
  ])

  const saveNeedsStepUp = (payload: BackupSettingsPut): boolean =>
    Boolean(payload.service_account) || payload.archive_passphrase !== undefined

  const runSave = async (payload: PendingSave) => {
    setFormError(null)
    setFormSuccess(null)
    try {
      await updateBackupSettings(payload)
      setFormSuccess('Backup settings saved. The backup container will be recreated.')
      setServiceAccountDraft('')
      setPassphraseDraft('')
      setPassphraseAction('keep')
      if (settings.credentials_configured || payload.service_account) {
        setReplaceKeyOpen(false)
      }
      await queryClient.invalidateQueries({ queryKey: ['backups', 'settings'] })
      await queryClient.invalidateQueries({ queryKey: ['backups', 'status'] })
      onSaved?.()
    } catch (error) {
      if (isStepUpRequired(error)) {
        setPendingSave(payload)
        setStepUpOpen(true)
        return
      }
      setFormError('Could not save backup settings.')
    }
  }

  const saveMutation = useMutation({
    mutationFn: (payload: PendingSave) => runSave(payload),
  })

  const runTest = async (body: { service_account: string | null; bucket: string }) => {
    setTestResult(null)
    try {
      const result = await testBackupCredentials(body)
      setTestResult({
        ok: result.ok !== false,
        message: result.ok !== false ? 'Credentials can access the bucket.' : 'Test failed.',
      })
    } catch (error) {
      if (isStepUpRequired(error)) {
        setPendingTest(body)
        setStepUpOpen(true)
        return
      }
      setTestResult({ ok: false, message: 'Could not test credentials.' })
    }
  }

  const testMutation = useMutation({
    mutationFn: (body: { service_account: string | null; bucket: string }) => runTest(body),
  })

  const readServiceAccountFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      setFormError('Service account must be a .json file.')
      return
    }
    void file.text().then((text) => {
      setServiceAccountDraft(text.trim())
      setFormError(null)
    })
  }

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      readServiceAccountFile(file)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files.item(0)
    if (file) {
      readServiceAccountFile(file)
    }
  }

  const toggleHour = (hour: number) => {
    setScheduleHours((current) =>
      current.includes(hour) ? current.filter((value) => value !== hour) : [...current, hour],
    )
  }

  const handleSave = () => {
    const payload = buildSavePayload()
    if (!payload.bucket) {
      setFormError('Bucket name is required.')
      return
    }
    if (!payload.schedule_hours) {
      setFormError('Select at least one schedule hour.')
      return
    }
    if (saveNeedsStepUp(payload)) {
      setPendingSave(payload)
      setStepUpOpen(true)
      return
    }
    saveMutation.mutate(payload)
  }

  const handleTest = () => {
    const trimmedBucket = bucket.trim()
    if (!trimmedBucket) {
      setTestResult({ ok: false, message: 'Enter a bucket name first.' })
      return
    }
    const keyText = serviceAccountDraft.trim()
    let serviceAccount: string | null = null
    if (keyText) {
      serviceAccount = keyText
    } else if (!settings.credentials_configured) {
      setTestResult({ ok: false, message: 'Add a service account key to test.' })
      return
    }
    const body = { service_account: serviceAccount, bucket: trimmedBucket }
    if (serviceAccount) {
      setPendingTest(body)
      setStepUpOpen(true)
      return
    }
    testMutation.mutate(body)
  }

  const serviceAccountFieldId = `${idPrefix}-service-account`
  const bucketFieldId = `${idPrefix}-bucket`

  return (
    <section className="@container space-y-5" aria-labelledby={`${idPrefix}-settings-heading`}>
      {showHeading ? (
        <h2 id={`${idPrefix}-settings-heading`} className="text-base font-semibold">
          Backup settings
        </h2>
      ) : null}

      {formSuccess ? (
        <p className="inline-flex items-center gap-2 text-sm text-accent">
          <CheckCircle weight="regular" aria-hidden className="size-4" />
          {formSuccess}
        </p>
      ) : null}

      <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-sm font-medium">Google Cloud service account</span>
        {settings.credentials_configured && !replaceKeyOpen ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3 @min-[28rem]:flex-row @min-[28rem]:items-center @min-[28rem]:justify-between">
            <p className="inline-flex min-w-0 items-center gap-2 text-sm">
              <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 break-all font-mono">{settings.client_email}</span>
            </p>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setReplaceKeyOpen(true)}
            >
              Replace key
            </button>
          </div>
        ) : (
          <div
            className={`space-y-2 rounded-lg border border-dashed p-4 transition-colors duration-200 ${
              dragOver ? 'border-accent bg-muted/50' : 'border-border'
            }`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <FileArrowUp weight="regular" aria-hidden className="size-6 text-foreground" />
            <p className="text-sm text-muted-foreground">
              Drag and drop a service account .json file, paste JSON or base64 below.
            </p>
            <label htmlFor={serviceAccountFieldId} className="sr-only">
              Service account JSON or base64
            </label>
            <textarea
              id={serviceAccountFieldId}
              rows={4}
              value={serviceAccountDraft}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setServiceAccountDraft(event.target.value)}
            />
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              id={`${idPrefix}-service-account-file`}
              onChange={onFileInput}
            />
            <div className="flex flex-wrap gap-2">
              <label
                htmlFor={`${idPrefix}-service-account-file`}
                className="inline-block cursor-pointer rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted"
              >
                Choose .json file
              </label>
              {settings.credentials_configured ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    setReplaceKeyOpen(false)
                    setServiceAccountDraft('')
                  }}
                >
                  Cancel replace
                </button>
              ) : null}
            </div>
          </div>
        )}
        {serviceAccountDraft.trim() && !isJsonServiceAccount(serviceAccountDraft) ? (
          <p className="text-xs text-muted-foreground">Pasted value will be sent as base64.</p>
        ) : null}
      </div>

      <div className="grid gap-4 @min-[40rem]:grid-cols-2 @min-[64rem]:grid-cols-[minmax(0,1.6fr)_9rem_7rem_minmax(0,1.2fr)]">
        <div>
          <label htmlFor={bucketFieldId} className="block text-sm font-medium">
            GCS bucket
          </label>
          <input
            id={bucketFieldId}
            type="text"
            value={bucket}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(event) => setBucket(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-retention`} className="block text-sm font-medium">
            Retention (days)
          </label>
          <input
            id={`${idPrefix}-retention`}
            type="number"
            min={1}
            max={3650}
            value={retentionDays}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(event) => setRetentionDays(Number.parseInt(event.target.value, 10) || 1)}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-minute`} className="block text-sm font-medium">
            Minute
          </label>
          <input
            id={`${idPrefix}-minute`}
            type="number"
            min={0}
            max={59}
            value={scheduleMinute}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(event) => setScheduleMinute(Number.parseInt(event.target.value, 10) || 0)}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-timezone`} className="block text-sm font-medium">
            Timezone
          </label>
          <input
            id={`${idPrefix}-timezone`}
            type="text"
            list={listId}
            value={timezoneQuery}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(event) => {
              setTimezoneQuery(event.target.value)
              setTimezone(event.target.value)
            }}
            onBlur={() => {
              if (allTimeZones.includes(timezoneQuery)) {
                setTimezone(timezoneQuery)
              }
            }}
          />
          <datalist id={listId}>
            {timezoneMatches.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </div>
      </div>
      </div>

      <div className="space-y-2">
        <span id={`${idPrefix}-hours-label`} className="text-sm font-medium">
          Schedule hours (UTC clock)
        </span>
        <div
          className="grid w-max max-w-full grid-cols-[repeat(6,2.5rem)] gap-2 @min-[40rem]:grid-cols-[repeat(12,2.5rem)]"
          role="group"
          aria-labelledby={`${idPrefix}-hours-label`}
        >
          {HOUR_OPTIONS.map((hour) => {
            const selected = scheduleHours.includes(hour)
            return (
              <button
                key={hour}
                type="button"
                aria-pressed={selected}
                className={`flex size-10 items-center justify-center rounded-full border text-sm tabular-nums transition-colors duration-200 cursor-pointer ${
                  selected
                    ? 'border-accent bg-accent/15 font-semibold text-foreground'
                    : 'border-border font-medium text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => toggleHour(hour)}
              >
                {hour}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Archive passphrase</span>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
            aria-haspopup="dialog"
            aria-expanded={passphraseHelpOpen}
            onClick={() => setPassphraseHelpOpen(true)}
          >
            What does this do?
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Encrypts the database dump and a config archive of app secrets and data files.
        </p>
        {settings.archive_passphrase_set ? (
          <p className="text-sm">
            Passphrase is set.{' '}
            <span className="font-mono text-muted-foreground">••••••••</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No archive passphrase configured.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-200 cursor-pointer ${
              passphraseAction === 'set' ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted'
            }`}
            onClick={() => setPassphraseAction('set')}
          >
            {settings.archive_passphrase_set ? 'Replace passphrase' : 'Set passphrase'}
          </button>
          {settings.archive_passphrase_set ? (
            <button
              type="button"
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-200 cursor-pointer ${
                passphraseAction === 'clear'
                  ? 'border-destructive bg-destructive/10'
                  : 'border-border hover:bg-muted'
              }`}
              onClick={() => setPassphraseAction('clear')}
            >
              Clear passphrase
            </button>
          ) : null}
        </div>
        {passphraseAction === 'set' ? (
          <input
            type="password"
            autoComplete="new-password"
            value={passphraseDraft}
            placeholder="New archive passphrase"
            aria-label="New archive passphrase"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(event) => setPassphraseDraft(event.target.value)}
          />
        ) : null}
        {passphraseAction === 'clear' ? (
          <p className="text-sm text-destructive">
            Save to remove the passphrase. Later dumps upload unencrypted, and config archives
            stop.
          </p>
        ) : null}
      </div>

      {testResult ? (
        <p
          role={testResult.ok ? 'status' : 'alert'}
          className={`inline-flex items-center gap-2 text-sm ${
            testResult.ok ? 'text-accent' : 'text-destructive'
          }`}
        >
          {testResult.ok ? (
            <CheckCircle weight="regular" aria-hidden className="size-4" />
          ) : null}
          {testResult.message}
        </p>
      ) : null}

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          disabled={testMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleTest}
        >
          {testMutation.isPending ? (
            <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          ) : null}
          Test credentials
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSave}
        >
          {saveMutation.isPending ? (
            <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          ) : null}
          Save
        </button>
      </div>

      <PassphraseHelpDialog
        open={passphraseHelpOpen}
        onClose={closePassphraseHelp}
      />

      <StepUpDialog
        key={stepUpOpen ? `${idPrefix}-step-up-open` : `${idPrefix}-step-up-closed`}
        open={stepUpOpen}
        onCancel={() => {
          setStepUpOpen(false)
          setPendingSave(null)
          setPendingTest(null)
        }}
        onVerified={() => {
          setStepUpOpen(false)
          const savePayload = pendingSave
          const testPayload = pendingTest
          setPendingSave(null)
          setPendingTest(null)
          if (savePayload) {
            void runSave(savePayload)
          } else if (testPayload) {
            void runTest(testPayload)
          }
        }}
      />
    </section>
  )
}
