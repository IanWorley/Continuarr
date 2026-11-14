// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CSRF_COOKIE_NAME, JELLYFIN_CONNECTION_PATH, type JellyfinConnection } from '../api/client.ts'
import { API_KEY_MESSAGES, URL_MESSAGES } from './jellyfinChecks.ts'
import { JellyfinCard } from './JellyfinCard.tsx'

const SAVED_URL = 'http://jellyfin.home.lan:8096'
const NEW_URL = 'https://jf.example.net'
const API_KEY = '0123456789abcdef0123456789abcdef'
const HTTP_NO_CONTENT = 204
const HTTP_BAD_REQUEST = 400
const HTTP_INTERNAL_SERVER_ERROR = 500
// Long enough for a resolved fetch to reach the query cache and re-render.
const LOAD_SETTLE_MS = 50

const NOTHING_SAVED: JellyfinConnection = { url: null, apiKeyState: 'NONE' }
const STORED: JellyfinConnection = { url: SAVED_URL, apiKeyState: 'STORED' }

type Respond = () => Promise<Response>

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()

function stubBackend({ get, put }: { get: Respond[]; put?: Respond }) {
  const reads = [...get]
  fetchMock.mockImplementation((path, init) => {
    if (path !== JELLYFIN_CONNECTION_PATH) return Promise.reject(new Error(`Unexpected request to ${path}`))
    if (init?.method === 'PUT' && put) return put()
    const read = reads.length > 1 ? reads.shift() : reads[0]
    return read ? read() : Promise.reject(new Error('No GET stubbed'))
  })
}

const answer = (connection: JellyfinConnection): Respond => async () => Response.json(connection)
const status = (code: number): Respond => async () => new Response(null, { status: code })
const refused: Respond = async () => Response.json({ invalidFields: ['URL', 'API_KEY'] }, { status: HTTP_BAD_REQUEST })
const unreachable: Respond = async () => {
  throw new TypeError('Failed to fetch')
}

const notYetSet = (): void => undefined

/** A promise the test settles by hand, to land a response at a chosen moment. */
function deferred<T>() {
  let resolve: (value: T) => void = notYetSet
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function putBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => (typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined))
}

function openCard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <JellyfinCard />
    </QueryClientProvider>,
  )
}

const urlField = () => screen.getByLabelText<HTMLInputElement>('Server URL')
const keyField = () => screen.getByLabelText<HTMLInputElement>('API key')
const saveButton = () => screen.getByRole('button', { name: 'Save' })
const type = (field: HTMLInputElement, value: string) => fireEvent.change(field, { target: { value } })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // jsdom doesn't lay out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn<Element['scrollIntoView']>()
  document.cookie = `${CSRF_COOKIE_NAME}=token; path=/`
})

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`
  vi.unstubAllGlobals()
})

it('shows a first run as nothing saved, with no key', async () => {
  stubBackend({ get: [answer(NOTHING_SAVED)] })
  openCard()

  expect(await screen.findByText('No key saved yet')).toBeDefined()
  expect(screen.getByText('Not configured')).toBeDefined()
  expect(screen.getByText('Nothing saved yet.')).toBeDefined()
  expect(urlField().value).toBe('')
})

it('fills in the saved URL and says a key is saved without showing it', async () => {
  stubBackend({ get: [answer(STORED)] })
  openCard()

  expect(await screen.findByText('A key is saved')).toBeDefined()
  expect(screen.getByText('Configured')).toBeDefined()
  expect(urlField().value).toBe(SAVED_URL)
  expect(keyField().value).toBe('')
  expect(keyField().type).toBe('password')
})

it('fills in a saved URL that has no key and asks for the key', async () => {
  stubBackend({ get: [answer({ url: SAVED_URL, apiKeyState: 'NONE' })] })
  openCard()

  expect(await screen.findByText('No key saved yet')).toBeDefined()
  expect(screen.getByText('Not configured')).toBeDefined()
  expect(urlField().value).toBe(SAVED_URL)
})

it('shows the saved URL under a changed one', async () => {
  stubBackend({ get: [answer(STORED)] })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)

  expect(screen.getByText(`Saved: ${SAVED_URL}`)).toBeDefined()
  expect(screen.getByText('Unsaved changes')).toBeDefined()
})

it('needs the key again before a new URL is saved, and sends nothing until then', async () => {
  stubBackend({ get: [answer(STORED)] })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)
  fireEvent.click(saveButton())

  expect(screen.getByText(API_KEY_MESSAGES.empty)).toBeDefined()
  expect(keyField().getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(keyField())
  expect(screen.getByText('Fix 1 field, then save again. Your entries are kept.')).toBeDefined()
  expect(screen.getByText('Configured')).toBeDefined()
  expect(putBodies()).toHaveLength(0)
})

it('says there is nothing to save when nothing changed', async () => {
  stubBackend({ get: [answer(STORED)] })
  openCard()

  fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

  expect(screen.getByText('No changes to save.')).toBeDefined()
  expect(putBodies()).toHaveLength(0)
})

it('saves trimmed values, clears the key, and reports the save', async () => {
  stubBackend({ get: [answer(NOTHING_SAVED)], put: status(HTTP_NO_CONTENT) })
  openCard()

  type(await screen.findByLabelText('Server URL'), `  ${NEW_URL} `)
  type(keyField(), ` ${API_KEY}\n`)
  fireEvent.click(saveButton())

  expect(await screen.findByText('Saved. Continuarr uses this from now on.')).toBeDefined()
  expect(putBodies()).toEqual([{ url: NEW_URL, apiKey: API_KEY }])
  expect(keyField().value).toBe('')
  expect(screen.getByText('Configured')).toBeDefined()
  expect(screen.getByText('A key is saved')).toBeDefined()
})

it('puts its own message on each field a 400 names and keeps the saved pill', async () => {
  stubBackend({ get: [answer(STORED)], put: refused })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)
  type(keyField(), API_KEY)
  fireEvent.click(saveButton())

  expect(await screen.findByText('Fix 2 fields, then save again. Your entries are kept.')).toBeDefined()
  expect(urlField().getAttribute('aria-invalid')).toBe('true')
  expect(keyField().getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('Configured')).toBeDefined()
  expect(urlField().value).toBe(NEW_URL)
})

it('keeps a successful save when an older load lands after it', async () => {
  const slowLoad = deferred<Response>()
  stubBackend({ get: [answer(NOTHING_SAVED), () => slowLoad.promise], put: status(HTTP_NO_CONTENT) })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)
  type(keyField(), API_KEY)
  fireEvent(window, new Event('visibilitychange'))
  fireEvent.click(saveButton())
  await screen.findByText('Saved. Continuarr uses this from now on.')
  await act(async () => {
    slowLoad.resolve(Response.json(NOTHING_SAVED))
    await new Promise((resolve) => {
      setTimeout(resolve, LOAD_SETTLE_MS)
    })
  })

  expect(screen.getByText('Configured')).toBeDefined()
  expect(screen.getByText('A key is saved')).toBeDefined()
  expect(screen.queryByText('Not configured')).toBeNull()
})

it.each([
  { failure: 'a 500', put: status(HTTP_INTERNAL_SERVER_ERROR) },
  { failure: 'a network error', put: unreachable },
])('keeps the entries and offers Try again after $failure', async ({ put }) => {
  stubBackend({ get: [answer(STORED)], put })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)
  type(keyField(), API_KEY)
  fireEvent.click(saveButton())

  expect(await screen.findByText("Couldn't save your settings.")).toBeDefined()
  expect(screen.getByText('Last save failed. The saved settings still apply.')).toBeDefined()
  expect(urlField().value).toBe(NEW_URL)
  expect(keyField().value).toBe(API_KEY)
  expect(screen.getByText('Configured')).toBeDefined()

  const sentBody = { url: NEW_URL, apiKey: API_KEY }
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  await waitFor(() => expect(putBodies()).toEqual([sentBody, sentBody]))
})

it('shows a failed load as unknown and loads again on Retry', async () => {
  stubBackend({ get: [status(HTTP_INTERNAL_SERVER_ERROR), answer(STORED)] })
  openCard()

  expect(await screen.findByText("Couldn't load settings.")).toBeDefined()
  expect(screen.getByText('Unknown')).toBeDefined()
  expect(screen.queryByLabelText('Server URL')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

  expect(await screen.findByText('A key is saved')).toBeDefined()
})

it('rechecks a field marked wrong as it is fixed', async () => {
  stubBackend({ get: [answer(NOTHING_SAVED)] })
  openCard()

  type(await screen.findByLabelText('Server URL'), 'jellyfin.home.lan:8096')
  fireEvent.click(saveButton())
  expect(screen.getByText(URL_MESSAGES.scheme)).toBeDefined()

  type(urlField(), 'http://jellyfin.home.lan:8096')

  expect(screen.queryByText(URL_MESSAGES.scheme)).toBeNull()
  expect(urlField().hasAttribute('aria-invalid')).toBe(false)
})
