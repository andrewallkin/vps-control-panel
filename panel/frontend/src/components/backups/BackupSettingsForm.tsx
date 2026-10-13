import { CheckCircle, FileArrowUp, Spinner } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useId,
  useMemo,
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
    <section className="space-y-4" aria-labelledby={`${idPrefix}-settings-heading`}>
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

      <div className="space-y-2">
        <span className="text-sm font-medium">Google Cloud service account</span>
        {settings.credentials_configured && !replaceKeyOpen ? (
          <div className="space-y-2">
            <p className="inline-flex items-center gap-2 text-sm">
              <CheckCircle weight="regular" aria-hidden className="size-4 text-accent" />
              <span className="font-mono">{settings.client_email}</span>
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
            <label
              htmlFor={`${idPrefix}-service-account-file`}
              className="inline-block cursor-pointer rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted"
            >
              Choose .json file
            </label>
            {settings.credentials_configured ? (
              <button
                type="button"
                className="ml-2 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  setReplaceKeyOpen(false)
                  setServiceAccountDraft('')
                }}
              >
                Cancel replace
              </button>
            ) : null}
          </div>
        )}
        {serviceAccountDraft.trim() && !isJsonServiceAccount(serviceAccountDraft) ? (
          <p className="text-xs text-muted-foreground">Pasted value will be sent as base64.</p>
        ) : null}
      </div>

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

      <div className="space-y-2">
        <span className="text-sm font-medium">Schedule hours (UTC clock)</span>
        <div className="flex flex-wrap gap-2">
          {HOUR_OPTIONS.map((hour) => {
            const selected = scheduleHours.includes(hour)
            return (
              <button
                key={hour}
                type="button"
                aria-pressed={selected}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-200 cursor-pointer ${
                  selected
                    ? 'border-accent bg-accent/15 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => toggleHour(hour)}
              >
                {hour}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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

      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
        <span className="text-sm font-medium">Archive passphrase</span>
        <p className="text-sm text-muted-foreground">
          Losing this passphrase makes config archives unrecoverable.
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
          <p className="text-sm text-destructive">Save to remove the stored archive passphrase.</p>
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

      <div className="flex flex-wrap gap-2">
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
