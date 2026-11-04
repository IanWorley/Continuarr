import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useState } from 'react'
import {
  fetchJellyfinConnection,
  saveJellyfinConnection,
  type JellyfinConnection,
  type JellyfinConnectionProblem,
  type JellyfinConnectionRequest,
} from '../api/client.ts'
import { HEADING_CLASSES } from '../forms/formParts.tsx'
import {
  JellyfinConnectionForm,
  type JellyfinField,
  type JellyfinSaveOutcome,
} from './JellyfinConnectionForm.tsx'

const HTTP_NO_CONTENT = 204
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_SERVICE_UNAVAILABLE = 503

const JELLYFIN_CONNECTION_QUERY_KEY = ['jellyfin-connection'] as const

const OUTCOME_BY_STATUS: ReadonlyMap<number, JellyfinSaveOutcome> = new Map([
  [HTTP_NO_CONTENT, { kind: 'saved' }],
  [HTTP_UNAUTHORIZED, { kind: 'session-ended' }],
  [HTTP_SERVICE_UNAVAILABLE, { kind: 'no-encryption-key' }],
])

const FIELD_BY_PROBLEM_NAME: Record<JellyfinConnectionProblem['invalidFields'][number], JellyfinField> = {
  URL: 'url',
  API_KEY: 'apiKey',
}

async function submitJellyfinConnection(request: JellyfinConnectionRequest): Promise<JellyfinSaveOutcome> {
  try {
    const response = await saveJellyfinConnection(request)
    if (response.status === HTTP_BAD_REQUEST) return await outcomeOfBadRequest(response)
    return OUTCOME_BY_STATUS.get(response.status) ?? { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}

async function outcomeOfBadRequest(response: Response): Promise<JellyfinSaveOutcome> {
  const problem = (await response.json().catch(() => undefined)) as JellyfinConnectionProblem | undefined
  const fields = new Set(problem?.invalidFields.map((name) => FIELD_BY_PROBLEM_NAME[name]))
  return fields.size > 0 ? { kind: 'invalid', fields } : { kind: 'failed' }
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: JELLYFIN_CONNECTION_QUERY_KEY,
    queryFn: fetchJellyfinConnection,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [confirmedSaves, setConfirmedSaves] = useState(0)
  const [outcome, setOutcome] = useState<JellyfinSaveOutcome>()
  const mutation = useMutation({
    mutationFn: submitJellyfinConnection,
    // The variables hold the plaintext key. Each save resets the mutation once it settles, and with
    // no cache time no finished mutation keeps a copy, so the outcome lives in state instead.
    gcTime: 0,
    // Awaiting the refetch keeps the button on "Saving…" until the page shows what the server
    // stored, so "Connection saved." and the read-back appear together.
    onSuccess: async (result) => {
      if (result.kind !== 'saved') return
      await queryClient.invalidateQueries({ queryKey: JELLYFIN_CONNECTION_QUERY_KEY })
      setConfirmedSaves((count) => count + 1)
    },
  })

  function save(request: JellyfinConnectionRequest) {
    setOutcome(undefined)
    mutation.mutate(request, {
      onSettled: (result) => {
        setOutcome(result ?? { kind: 'failed' })
        mutation.reset()
      },
    })
  }

  return (
    <SettingsScreen
      load={toConnectionLoad(query)}
      confirmedSaves={confirmedSaves}
      submitting={mutation.isPending}
      outcome={outcome}
      onSave={save}
    />
  )
}

export type ConnectionLoad =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; connection: JellyfinConnection | null }

function toConnectionLoad(query: UseQueryResult<JellyfinConnection | null>): ConnectionLoad {
  if (query.isPending || !query.isFetchedAfterMount) return { status: 'loading' }
  if (query.isError) return { status: 'failed' }
  return { status: 'loaded', connection: query.data }
}

export interface SettingsScreenProps {
  load: ConnectionLoad
  confirmedSaves: number
  submitting: boolean
  outcome: JellyfinSaveOutcome | undefined
  onSave: (request: JellyfinConnectionRequest) => void
}

export function SettingsScreen({ load, confirmedSaves, submitting, outcome, onSave }: SettingsScreenProps) {
  return (
    <div className="px-6 py-8">
      <h1 className={HEADING_CLASSES}>Jellyfin connection</h1>
      <p className="mt-2 max-w-md text-sm text-ink-400">
        Continuarr reads your users and libraries from Jellyfin. Saving replaces the URL and the API key together, so
        enter the key each time.
      </p>

      {load.status === 'loading' && (
        <output className="mt-6 block text-sm text-ink-400">Loading the saved connection…</output>
      )}
      {load.status === 'failed' && (
        <p role="alert" className="mt-6 text-sm text-danger">
          Couldn't load the saved connection. Reload the page to try again.
        </p>
      )}
      {load.status === 'loaded' && (
        <>
          <SavedConnection connection={load.connection} />
          <JellyfinConnectionForm
            savedUrl={load.connection?.url}
            confirmedSaves={confirmedSaves}
            submitting={submitting}
            outcome={outcome}
            onSubmit={onSave}
          />
        </>
      )}
    </div>
  )
}

function SavedConnection({ connection }: { connection: JellyfinConnection | null }) {
  return (
    <section aria-label="Saved connection" className="mt-6 max-w-md rounded-md border border-ink-700 px-4 py-3 text-sm">
      {connection ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-ink-400">Server URL</dt>
          <dd className="font-mono break-all">{connection.url}</dd>
          <dt className="text-ink-400">API key</dt>
          <dd>Stored</dd>
        </dl>
      ) : (
        <p className="text-ink-400">Nothing saved yet.</p>
      )}
    </section>
  )
}
