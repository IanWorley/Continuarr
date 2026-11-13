import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react'
import {
  fetchJellyfinConnection,
  HttpStatusError,
  patchJellyfinConnection,
  type JellyfinConnection,
  type JellyfinConnectionPatch,
  type JellyfinConnectionProblem,
} from '../api/client.ts'
import {
  Banner,
  BUSY_BUTTON_CLASSES,
  COMPACT_FIELD_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  SECONDARY_BUTTON_CLASSES,
  Spinner,
  UNAVAILABLE_BUTTON_CLASSES,
} from '../auth/formParts.tsx'
import { Icon, type IconName } from '../shell/Icon.tsx'
import { FieldRow, Pill, ROW, ROW_LABEL, SectionTitle, SMALL_TEXT, type PillTone } from './cardParts.tsx'
import { checkApiKey, checkUrl } from './jellyfinChecks.ts'
import { planSave, type Draft, type Field, type FieldErrors } from './jellyfinSave.ts'

const JELLYFIN_CONNECTION_QUERY_KEY = ['jellyfin-connection'] as const

const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_SERVICE_UNAVAILABLE = 503

const URL_PLACEHOLDER = 'http://jellyfin.local:8096'
const URL_HELP = 'The address Continuarr uses to reach Jellyfin, like http://jellyfin.local:8096.'
// The server named a field the card's own check let through. Unlikely while the checks mirror the parsers.
const URL_REFUSED = "Continuarr couldn't use this address. Check it, then save again."
const KEY_REFUSED = "Continuarr couldn't use this key. Copy it again from Dashboard › API Keys."
// Shown as placeholder text, never as the field's value, so nothing secret can be submitted or copied.
const SAVED_KEY_DOTS = '••••••••••••••••••••••••'

type ApiKeyState = JellyfinConnection['apiKeyState']
type ServerField = JellyfinConnectionProblem['invalidFields'][number]

const FIELDS: readonly Field[] = ['url', 'apiKey']
const SERVER_FIELDS: Record<ServerField, Field> = { URL: 'url', API_KEY: 'apiKey' }
const CHECKS: Record<Field, (value: string) => string | null> = { url: checkUrl, apiKey: checkApiKey }
const REFUSED: Record<Field, string> = { url: URL_REFUSED, apiKey: KEY_REFUSED }

/** What the last Save left to say. Cleared by the next edit, because it no longer describes the form. */
type Outcome =
  | { kind: 'saved' }
  | { kind: 'unchanged' }
  | { kind: 'invalid'; count: number }
  | { kind: 'failed' }
  | { kind: 'session-ended' }

/** The pill always shows what is saved, so a failed save never changes it. */
const SAVED_PILLS: Record<ApiKeyState, { tone: PillTone; text: string }> = {
  NONE: { tone: 'off', text: 'Not configured' },
  STORED: { tone: 'ok', text: 'Configured' },
  UNREADABLE: { tone: 'warn', text: 'Key unreadable' },
}

const KEY_STATES: Record<ApiKeyState, { icon: IconName; text: string; tone: string }> = {
  NONE: { icon: 'unlock', text: 'No key saved yet', tone: 'text-ink-400' },
  STORED: { icon: 'lock', text: 'A key is saved. Leave this empty to keep it.', tone: 'text-ink-100' },
  UNREADABLE: {
    icon: 'warn',
    text: "Continuarr can't read the saved key. It was saved under a different CONTINUARR_ENCRYPTION_KEY, or none is set now. Paste the key and save again.",
    tone: 'text-warn',
  },
}

function invalidNote(count: number): string {
  return `Fix ${count} ${count === 1 ? 'field' : 'fields'}, then save again. Your entries are kept.`
}

function CardHead({ titleId, meta, pill }: { titleId: string; meta: ReactNode; pill?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-ink-700 px-3.5 py-3">
      <span
        aria-hidden="true"
        className="grid size-7 flex-none place-items-center rounded-md border border-ink-700 bg-ink-800 font-extrabold text-jellyfin"
      >
        J
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-card-title font-semibold">
          Jellyfin
        </h2>
        <p className={`wrap-anywhere text-ink-400 ${SMALL_TEXT}`}>{meta}</p>
      </div>
      {pill}
    </div>
  )
}

/** The card's frame. Every state, loading included, shares the head, so the page doesn't jump. */
export function JellyfinCard() {
  const titleId = useId()
  const query = useQuery({
    queryKey: JELLYFIN_CONNECTION_QUERY_KEY,
    queryFn: fetchJellyfinConnection,
    // The load-failed banner has its own Retry, so it appears at once instead of after several silent tries.
    retry: false,
  })

  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-lg border border-ink-700 bg-ink-900">
      {/* Checked before the data, because a failed refetch keeps the last data it loaded. */}
      {query.error instanceof HttpStatusError && query.error.status === HTTP_UNAUTHORIZED ? (
        <SessionEnded titleId={titleId} />
      ) : query.data ? (
        <JellyfinForm titleId={titleId} saved={query.data} reload={() => void query.refetch()} />
      ) : query.isError ? (
        <LoadFailed titleId={titleId} retry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <Loading titleId={titleId} />
      )}
    </section>
  )
}

function Loading({ titleId }: { titleId: string }) {
  return (
    <>
      <CardHead titleId={titleId} meta="Loading…" />
      <SectionTitle>Connection</SectionTitle>
      <div aria-busy="true" className="px-3.5 pt-1.5 pb-2.5">
        {['Server URL', 'API key'].map((label) => (
          <div key={label} className={ROW}>
            <span className={ROW_LABEL}>{label}</span>
            <span className="mt-1 h-3 w-3/5 rounded-sm bg-ink-800 motion-safe:animate-pulse tablet:mt-3" />
          </div>
        ))}
      </div>
    </>
  )
}

function LoadFailed({ titleId, retry, retrying }: { titleId: string; retry: () => void; retrying: boolean }) {
  return (
    <>
      <CardHead titleId={titleId} meta="Settings not loaded" pill={<Pill tone="warn">Unknown</Pill>} />
      <div role="alert" className="mx-3.5 mt-2.5">
        <Banner
          tone="danger"
          title="Couldn't load settings."
          action={
            <button type="button" aria-disabled={retrying} onClick={retry} className={SECONDARY_BUTTON_CLASSES}>
              Retry
            </button>
          }
        >
          Retry before you change anything here.
        </Banner>
      </div>
      <div className="px-3.5 pt-1.5 pb-2.5">
        {['Server URL', 'API key'].map((label) => (
          <div key={label} className={ROW}>
            <span className={ROW_LABEL}>{label}</span>
            <span className="text-ink-400 tablet:pt-2">Not loaded</span>
          </div>
        ))}
      </div>
    </>
  )
}

function SignInLink() {
  return (
    <Link to="/login" className={SECONDARY_BUTTON_CLASSES}>
      Sign in
    </Link>
  )
}

function SessionEnded({ titleId }: { titleId: string }) {
  return (
    <>
      <CardHead titleId={titleId} meta="Settings not loaded" pill={<Pill tone="warn">Unknown</Pill>} />
      <div role="alert" className="mx-3.5 my-2.5">
        <Banner tone="danger" title="Your session ended." action={<SignInLink />}>
          Sign in again to see these settings.
        </Banner>
      </div>
    </>
  )
}

interface JellyfinFormProps {
  titleId: string
  saved: JellyfinConnection
  reload: () => void
}

function JellyfinForm({ titleId, saved, reload }: JellyfinFormProps) {
  const queryClient = useQueryClient()
  const formId = useId()
  const ids = { url: useId(), apiKey: useId(), keyState: useId(), urlHelp: useId(), keyHelp: useId() }
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})
  const savedUrl = saved.url ?? ''
  const [draft, setDraft] = useState<Draft>({ url: savedUrl, apiKey: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [outcome, setOutcome] = useState<Outcome>()
  // Each outcome gets a new key, so a repeated note is announced again.
  const [outcomeSerial, setOutcomeSerial] = useState(0)
  const [saving, setSaving] = useState(false)
  const [encryptionKeyMissing, setEncryptionKeyMissing] = useState(false)
  // A save that would send the saved key to a different server waits here for the admin to confirm.
  const [pendingHost, setPendingHost] = useState<{ host: string; patch: JellyfinConnectionPatch }>()

  const urlChanged = draft.url.trim() !== savedUrl
  const dirty = urlChanged || draft.apiKey !== ''
  const saveUnavailable = saving || encryptionKeyMissing

  function report(next: Outcome) {
    setOutcome(next)
    setOutcomeSerial((serial) => serial + 1)
  }

  function edit(field: Field, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setOutcome(undefined)
    setPendingHost(undefined)
    // A field already marked wrong rechecks as you type, so the message goes away once it's fixed.
    if (errors[field]) setErrors((current) => ({ ...current, [field]: CHECKS[field](value.trim()) ?? undefined }))
  }

  function showErrors(found: FieldErrors) {
    setErrors(found)
    report({ kind: 'invalid', count: Object.keys(found).length })
    const first = FIELDS.map((field) => (found[field] ? inputs.current[field] : undefined)).find(Boolean)
    // Focus without the browser's jump, then scroll the whole row, so its label clears the header and toolbar.
    first?.focus({ preventScroll: true })
    first?.closest('[data-field-row]')?.scrollIntoView({ block: 'nearest' })
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saveUnavailable) return
    setPendingHost(undefined)
    const plan = planSave(saved, draft)
    switch (plan.kind) {
      case 'unchanged':
        setErrors({})
        report({ kind: 'unchanged' })
        return
      case 'invalid':
        showErrors(plan.errors)
        return
      case 'confirm-host':
        setErrors({})
        setOutcome(undefined)
        setPendingHost({ host: plan.host, patch: plan.patch })
        return
      case 'send':
        await send(plan.patch)
    }
  }

  async function send(patch: JellyfinConnectionPatch) {
    setPendingHost(undefined)
    setSaving(true)
    const response = await patchJellyfinConnection(patch).catch(() => undefined)
    setSaving(false)
    if (response?.ok) {
      // A GET still in flight, from Reload settings or a window refocus, may hold what was saved before this.
      await queryClient.cancelQueries({ queryKey: JELLYFIN_CONNECTION_QUERY_KEY })
      const url = patch.url ?? saved.url ?? null
      setErrors({})
      setDraft({ url: url ?? '', apiKey: '' })
      // Without a new key the server kept the saved one, so its state is what it was.
      const apiKeyState = patch.apiKey ? 'STORED' : saved.apiKeyState
      queryClient.setQueryData<JellyfinConnection>(JELLYFIN_CONNECTION_QUERY_KEY, { url, apiKeyState })
      report({ kind: 'saved' })
    } else if (response?.status === HTTP_UNAUTHORIZED) {
      report({ kind: 'session-ended' })
    } else if (response?.status === HTTP_SERVICE_UNAVAILABLE) {
      setOutcome(undefined)
      setEncryptionKeyMissing(true)
    } else if (response?.status === HTTP_BAD_REQUEST) {
      const named = await namedFields(response)
      const sent: Draft = { url: patch.url ?? draft.url.trim(), apiKey: patch.apiKey ?? '' }
      if (named.length > 0) {
        showErrors(Object.fromEntries(named.map((field) => [field, CHECKS[field](sent[field]) ?? REFUSED[field]])))
      } else {
        report({ kind: 'failed' })
      }
    } else {
      report({ kind: 'failed' })
    }
  }

  function reloadSettings() {
    setEncryptionKeyMissing(false)
    reload()
  }

  const meta = saving ? (
    'Saving…'
  ) : outcome?.kind === 'session-ended' ? (
    'Not saved. Sign in again.'
  ) : outcome?.kind === 'failed' ? (
    saved.url ? 'Last save failed. The saved settings still apply.' : 'Last save failed.'
  ) : encryptionKeyMissing ? (
    'Not saved'
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 font-semibold text-ink-100 before:size-1.75 before:rounded-full before:border-[1.5px] before:border-current">
      Unsaved changes
    </span>
  ) : (
    (saved.url ?? 'Not connected yet')
  )
  const savedPill = SAVED_PILLS[saved.apiKeyState]
  const keySaved = saved.apiKeyState === 'STORED'
  const keyState =
    keySaved && draft.apiKey !== ''
      ? { ...KEY_STATES.STORED, text: 'Your typed key replaces the saved one when you save.' }
      : KEY_STATES[saved.apiKeyState]
  const keyHelp = keySaved
    ? 'Type a key only to replace the saved one.'
    : 'Create one in Jellyfin under Dashboard › API Keys.'
  const note = encryptionKeyMissing
    ? 'Save is off until the server can encrypt the key.'
    : outcome?.kind === 'unchanged'
      ? 'No changes to save.'
      : outcome?.kind === 'invalid'
        ? invalidNote(outcome.count)
        : !outcome && !dirty && !saved.url
          ? 'Nothing saved yet.'
          : undefined

  return (
    <>
      <CardHead titleId={titleId} meta={meta} pill={<Pill tone={savedPill.tone}>{savedPill.text}</Pill>} />
      <div aria-live="polite">
        {encryptionKeyMissing && (
          <div className="mx-3.5 mt-2.5">
            <Banner
              tone="warn"
              title="Continuarr can't store the API key yet."
              action={
                <button type="button" onClick={reloadSettings} className={SECONDARY_BUTTON_CLASSES}>
                  <Icon name="refresh" className="size-3.75" />
                  Reload settings
                </button>
              }
            >
              Set <code className="rounded-sm border border-ink-700 bg-ink-800 px-1 text-xs text-ink-100">CONTINUARR_ENCRYPTION_KEY</code>{' '}
              in your server's environment and restart Continuarr. Then reload settings and save again.
            </Banner>
          </div>
        )}
        {pendingHost && (
          <div className="mx-3.5 mt-2.5">
            <Banner
              tone="warn"
              title={`Send the saved key to ${pendingHost.host}?`}
              action={
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPendingHost(undefined)} className={SECONDARY_BUTTON_CLASSES}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => void send(pendingHost.patch)} className={PRIMARY_BUTTON_CLASSES}>
                    Send saved key
                  </button>
                </div>
              }
            >
              Only do this if it's the same Jellyfin server. Continuarr sends the key with every request to this address.
            </Banner>
          </div>
        )}
        {outcome?.kind === 'session-ended' && (
          <div className="mx-3.5 mt-2.5">
            <Banner tone="danger" title="Your session ended." action={<SignInLink />}>
              Sign in again, then save.
            </Banner>
          </div>
        )}
        {outcome?.kind === 'failed' && (
          <div className="mx-3.5 mt-2.5">
            <Banner
              tone="danger"
              title="Couldn't save your settings."
              action={
                <button type="submit" form={formId} className={SECONDARY_BUTTON_CLASSES}>
                  Try again
                </button>
              }
            >
              Your entries are still here.
            </Banner>
          </div>
        )}
      </div>
      <form id={formId} aria-labelledby={titleId} noValidate onSubmit={(event) => void save(event)}>
        <SectionTitle>Connection</SectionTitle>
        <div className="px-3.5 pt-1.5 pb-2.5">
          <FieldRow
            label="Server URL"
            inputId={ids.url}
            error={errors.url}
            hints={
              <p id={ids.urlHelp} className={`text-ink-400 ${SMALL_TEXT}`}>
                {urlChanged && saved.url ? `Saved: ${saved.url}` : URL_HELP}
              </p>
            }
          >
            <input
              ref={(element) => {
                inputs.current.url = element
              }}
              id={ids.url}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={URL_PLACEHOLDER}
              value={draft.url}
              readOnly={saving}
              aria-invalid={errors.url ? true : undefined}
              aria-describedby={[errors.url && `${ids.url}-error`, ids.urlHelp].filter(Boolean).join(' ')}
              onChange={(event) => edit('url', event.target.value)}
              className={COMPACT_FIELD_CLASSES}
            />
          </FieldRow>
          <FieldRow
            label="API key"
            inputId={ids.apiKey}
            error={errors.apiKey}
            hints={
              <>
                <p id={ids.keyState} className={`flex items-start gap-1.5 ${keyState.tone} ${SMALL_TEXT}`}>
                  <Icon name={keyState.icon} className="mt-0.5 size-3.75" />
                  {keyState.text}
                </p>
                <p id={ids.keyHelp} className={`text-ink-400 ${SMALL_TEXT}`}>
                  {keyHelp}
                </p>
              </>
            }
          >
            <input
              ref={(element) => {
                inputs.current.apiKey = element
              }}
              id={ids.apiKey}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={keySaved ? SAVED_KEY_DOTS : 'Paste the API key'}
              value={draft.apiKey}
              readOnly={saving}
              aria-invalid={errors.apiKey ? true : undefined}
              aria-describedby={[errors.apiKey && `${ids.apiKey}-error`, ids.keyState, ids.keyHelp]
                .filter(Boolean)
                .join(' ')}
              onChange={(event) => edit('apiKey', event.target.value)}
              className={`${COMPACT_FIELD_CLASSES} ${keySaved ? 'placeholder:tracking-widest placeholder:text-ink-100' : ''}`}
            />
          </FieldRow>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t border-ink-700 bg-ink-850 px-3.5 py-2.5">
          <output className={SMALL_TEXT}>
            {outcome?.kind === 'saved' ? (
              <p key={outcomeSerial} className="flex items-center gap-1.5 font-semibold text-ok">
                <Icon name="check" className="size-3.75" />
                Saved. Continuarr uses this from now on.
              </p>
            ) : (
              note && (
                <p key={outcomeSerial} className="text-ink-400">
                  {note}
                </p>
              )
            )}
          </output>
          <div className="flex w-full tablet:ml-auto tablet:w-auto">
            <button
              type="submit"
              aria-disabled={saveUnavailable}
              className={`flex-1 ${PRIMARY_BUTTON_CLASSES} ${saving ? BUSY_BUTTON_CLASSES : UNAVAILABLE_BUTTON_CLASSES}`}
            >
              {saving ? <Spinner /> : <Icon name="save" className="size-3.75" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </>
  )
}

/** The fields a 400 names, from a body the server may leave empty or malformed. */
async function namedFields(response: Response): Promise<Field[]> {
  const body: unknown = await response.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null || !('invalidFields' in body) || !Array.isArray(body.invalidFields)) {
    return []
  }
  return body.invalidFields.flatMap((name: unknown) => (isServerField(name) ? [SERVER_FIELDS[name]] : []))
}

function isServerField(name: unknown): name is ServerField {
  return typeof name === 'string' && Object.hasOwn(SERVER_FIELDS, name)
}
