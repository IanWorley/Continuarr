import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useImperativeHandle, useRef, useState, type Ref, type SubmitEvent } from 'react'
import {
  saveJellyfinConnection,
  type JellyfinConnection,
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
import {
  CardHead,
  ComingLater,
  FieldRow,
  Pill,
  ROW,
  ROW_LABEL,
  SectionTitle,
  SMALL_TEXT,
  type PillTone,
} from './cardParts.tsx'
import { checkApiKey, checkUrl } from './jellyfinChecks.ts'
import { jellyfinConnectionQuery, type CardHandle } from './servers.ts'

const HTTP_BAD_REQUEST = 400

const URL_PLACEHOLDER = 'http://jellyfin.local:8096'
const URL_HELP = 'The address Continuarr uses to reach Jellyfin, like http://jellyfin.local:8096.'
// The server named a field the card's own check let through. Unlikely while the checks mirror the parsers.
const URL_REFUSED = "Continuarr couldn't use this address. Check it, then save again."
const KEY_REFUSED = "Continuarr couldn't use this key. Copy it again from Dashboard › API Keys."

type Field = 'url' | 'apiKey'
type Draft = Record<Field, string>
type FieldErrors = Partial<Record<Field, string>>
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

/** The pill always shows what is saved, so a failed save never changes it. */
const SAVED_PILLS: Record<ApiKeyState, { tone: PillTone; text: string }> = {
  NONE: { tone: 'off', text: 'Not configured' },
  STORED: { tone: 'ok', text: 'Configured' },
}

const KEY_STATES: Record<ApiKeyState, { icon: IconName; text: string; tone: string }> = {
  NONE: { icon: 'unlock', text: 'No key saved yet', tone: 'text-ink-400' },
  STORED: { icon: 'lock', text: 'A key is saved', tone: 'text-ink-100' },
}

function invalidNote(count: number): string {
  return `Fix ${count} ${count === 1 ? 'field' : 'fields'}, then save again. Your entries are kept.`
}

/** The card's frame. `ref` reports unsaved edits, so the page can ask before Reload discards them. */
export function JellyfinCard({ ref }: { ref?: Ref<CardHandle> }) {
  const titleId = useId()
  // The page loads this too, and remounts the card after a reload it has already fetched.
  const query = useQuery({ ...jellyfinConnectionQuery, refetchOnMount: false })

  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-lg border border-ink-700 bg-ink-900">
      {query.data ? (
        <JellyfinForm ref={ref} titleId={titleId} saved={query.data} />
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
      <CardHead kind="jellyfin" titleId={titleId} meta="Loading…" />
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
      <CardHead kind="jellyfin" titleId={titleId} meta="Settings not loaded" pill={<Pill tone="warn">Unknown</Pill>} />
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

interface JellyfinFormProps {
  ref: Ref<CardHandle> | undefined
  titleId: string
  saved: JellyfinConnection
}

function JellyfinForm({ ref, titleId, saved }: JellyfinFormProps) {
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

  const urlChanged = draft.url.trim() !== savedUrl
  const dirty = urlChanged || draft.apiKey !== ''
  useImperativeHandle(ref, () => ({ unsaved: dirty }), [dirty])

  function report(next: Outcome) {
    setOutcome(next)
    setOutcomeSerial((serial) => serial + 1)
  }

  function edit(field: Field, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setOutcome(undefined)
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
    if (saving) return
    const sent: Draft = { url: draft.url.trim(), apiKey: draft.apiKey.trim() }
    if (!dirty) {
      setErrors({})
      report({ kind: 'unchanged' })
      return
    }
    const found: FieldErrors = {}
    for (const field of FIELDS) {
      const message = CHECKS[field](sent[field])
      if (message) found[field] = message
    }
    if (Object.keys(found).length > 0) {
      showErrors(found)
      return
    }

    setSaving(true)
    const response = await saveJellyfinConnection(sent).catch(() => undefined)
    setSaving(false)
    if (response?.ok) {
      // A GET still in flight, from Reload settings or a window refocus, may hold what was saved before this.
      await queryClient.cancelQueries({ queryKey: jellyfinConnectionQuery.queryKey })
      setErrors({})
      setDraft({ url: sent.url, apiKey: '' })
      queryClient.setQueryData<JellyfinConnection>(jellyfinConnectionQuery.queryKey, { url: sent.url, apiKeyState: 'STORED' })
      report({ kind: 'saved' })
    } else if (response?.status === HTTP_BAD_REQUEST) {
      const named = await namedFields(response)
      if (named.length > 0) {
        showErrors(Object.fromEntries(named.map((field) => [field, CHECKS[field](sent[field]) ?? REFUSED[field]])))
      } else {
        report({ kind: 'failed' })
      }
    } else {
      report({ kind: 'failed' })
    }
  }

  const meta = saving ? (
    'Saving…'
  ) : outcome?.kind === 'failed' ? (
    saved.url ? 'Last save failed. The saved settings still apply.' : 'Last save failed.'
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 font-semibold text-ink-100 before:size-1.75 before:rounded-full before:border-[1.5px] before:border-current">
      Unsaved changes
    </span>
  ) : (
    (saved.url ?? 'Not connected yet')
  )
  const savedPill = SAVED_PILLS[saved.apiKeyState]
  const keyState =
    saved.apiKeyState === 'STORED' && draft.apiKey !== ''
      ? { ...KEY_STATES.STORED, text: 'Your saved key is unchanged.' }
      : KEY_STATES[saved.apiKeyState]
  const keyHelp =
    saved.apiKeyState === 'NONE'
      ? 'Create one in Jellyfin under Dashboard › API Keys.'
      : 'Every save needs the key, so a new URL never receives the old one.'
  const note =
    outcome?.kind === 'unchanged'
      ? 'No changes to save.'
      : outcome?.kind === 'invalid'
        ? invalidNote(outcome.count)
        : !outcome && !dirty && !saved.url
          ? 'Nothing saved yet.'
          : undefined

  return (
    <>
      <CardHead kind="jellyfin" titleId={titleId} meta={meta} pill={<Pill tone={savedPill.tone}>{savedPill.text}</Pill>} />
      <div aria-live="polite">
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
              placeholder={saved.apiKeyState === 'NONE' ? 'Paste the API key' : 'Paste the API key to save'}
              value={draft.apiKey}
              readOnly={saving}
              aria-invalid={errors.apiKey ? true : undefined}
              aria-describedby={[errors.apiKey && `${ids.apiKey}-error`, ids.keyState, ids.keyHelp]
                .filter(Boolean)
                .join(' ')}
              onChange={(event) => edit('apiKey', event.target.value)}
              className={COMPACT_FIELD_CLASSES}
            />
          </FieldRow>
        </div>
        <ComingLater kind="jellyfin" />
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
              aria-disabled={saving}
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
