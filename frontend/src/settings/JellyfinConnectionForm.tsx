import { useEffect, useId, useRef, type FormEvent } from 'react'
import type { JellyfinConnectionRequest } from '../api/client.ts'
import { FIELD_CLASSES, FieldError, FormAlert, LABEL_CLASSES, SubmitButton } from '../forms/formParts.tsx'

export type JellyfinField = keyof JellyfinConnectionRequest

export type JellyfinSaveOutcome =
  | { kind: 'saved' }
  | { kind: 'invalid'; fields: ReadonlySet<JellyfinField> }
  | { kind: 'no-encryption-key' }
  | { kind: 'session-ended' }
  | { kind: 'failed' }

type AlertKind = Exclude<JellyfinSaveOutcome['kind'], 'saved' | 'invalid'>

const FIELD_MESSAGES: Record<JellyfinField, string> = {
  url: 'Enter an http:// or https:// address with a host, such as http://jellyfin.local:8096, and no username, password, query, or #fragment.',
  apiKey: "Paste the key from Jellyfin's Dashboard, under API Keys. It can't contain spaces, quotes, or backslashes.",
}

const ALERT_MESSAGES: Record<AlertKind, string> = {
  'no-encryption-key':
    "Continuarr can't store the API key because CONTINUARR_ENCRYPTION_KEY isn't set on the server. Set it and restart Continuarr.",
  'session-ended': 'Your session ended. Reload the page to sign in again.',
  failed: "Couldn't save the connection. Try again in a moment.",
}

const NO_INVALID_FIELDS: ReadonlySet<JellyfinField> = new Set()

export interface JellyfinConnectionFormProps {
  savedUrl: string | undefined
  confirmedSaves: number
  submitting: boolean
  outcome: JellyfinSaveOutcome | undefined
  onSubmit: (request: JellyfinConnectionRequest) => void
}

export function JellyfinConnectionForm({ savedUrl, confirmedSaves, submitting, outcome, onSubmit }: JellyfinConnectionFormProps) {
  const alertId = useId()
  const urlErrorId = useId()
  const apiKeyErrorId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const invalidFields = outcome?.kind === 'invalid' ? outcome.fields : NO_INVALID_FIELDS
  const alert = outcome && outcome.kind !== 'saved' && outcome.kind !== 'invalid' ? ALERT_MESSAGES[outcome.kind] : undefined

  // Resets in place rather than remounting the inputs, so keyboard focus stays where the admin left it.
  useEffect(() => {
    if (confirmedSaves > 0) formRef.current?.reset()
  }, [confirmedSaves])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const form = new FormData(event.currentTarget)
    onSubmit({
      url: String(form.get('url')).trim(),
      apiKey: String(form.get('apiKey')).trim(),
    })
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-label="Jellyfin connection" className="max-w-md">
      <FormAlert id={alertId}>{alert}</FormAlert>
      {/* Always mounted, so screen readers announce the text when it appears. */}
      <output className="mt-6 block text-sm text-ink-100 empty:hidden">
        {outcome?.kind === 'saved' && 'Connection saved.'}
      </output>

      <div className="mt-6 space-y-5">
        <div>
          <label className={LABEL_CLASSES}>
            Server URL
            <input
              name="url"
              type="text"
              inputMode="url"
              defaultValue={savedUrl}
              placeholder="http://jellyfin.local:8096"
              autoComplete="url"
              spellCheck={false}
              required
              aria-invalid={invalidFields.has('url')}
              aria-describedby={invalidFields.has('url') ? urlErrorId : undefined}
              className={FIELD_CLASSES}
            />
          </label>
          <FieldError id={urlErrorId}>{invalidFields.has('url') && FIELD_MESSAGES.url}</FieldError>
        </div>
        <div>
          <label className={LABEL_CLASSES}>
            API key
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={invalidFields.has('apiKey')}
              aria-describedby={invalidFields.has('apiKey') ? apiKeyErrorId : undefined}
              className={`${FIELD_CLASSES} font-mono`}
            />
          </label>
          <FieldError id={apiKeyErrorId}>{invalidFields.has('apiKey') && FIELD_MESSAGES.apiKey}</FieldError>
        </div>

        <SubmitButton submitting={submitting} label="Save connection" submittingLabel="Saving…" />
      </div>
    </form>
  )
}
