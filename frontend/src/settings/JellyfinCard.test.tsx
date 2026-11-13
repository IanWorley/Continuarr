// @vitest-environment jsdom
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CSRF_COOKIE_NAME, JELLYFIN_CONNECTION_PATH, type JellyfinConnection } from '../api/client.ts'
import { URL_MESSAGES } from './jellyfinChecks.ts'
import { KEY_FOR_HTTP } from './jellyfinSave.ts'
import { JellyfinCard } from './JellyfinCard.tsx'

const SAVED_URL = 'http://jellyfin.home.lan:8096'
const NEW_URL = 'https://jf.example.net'
const SAME_SERVER_URL = 'http://jellyfin.home.lan:8920/jellyfin'
const HTTPS_SAVED_URL = 'https://jellyfin.home.lan:8920'
// Placeholder text matched loosely, so the copy can grow without breaking every test.
const KEY_SAVED = /A key is saved/
const SAVED_KEY_DOTS = /^•+$/
const API_KEY = '0123456789abcdef0123456789abcdef'
const HTTP_NO_CONTENT = 204
const HTTP_UNAUTHORIZED = 401
const HTTP_BAD_REQUEST = 400
const HTTP_INTERNAL_SERVER_ERROR = 500
const HTTP_SERVICE_UNAVAILABLE = 503
// Long enough for a resolved fetch to reach the query cache and re-render.
const LOAD_SETTLE_MS = 50

const NOTHING_SAVED: JellyfinConnection = { url: null, apiKeyState: 'NONE' }
const STORED: JellyfinConnection = { url: SAVED_URL, apiKeyState: 'STORED' }

type Respond = () => Promise<Response>

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()

function stubBackend({ get, patch }: { get: Respond[]; patch?: Respond }) {
  const reads = [...get]
  fetchMock.mockImplementation((path, init) => {
    if (path !== JELLYFIN_CONNECTION_PATH) return Promise.reject(new Error(`Unexpected request to ${path}`))
    if (init?.method === 'PATCH' && patch) return patch()
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

function patchBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => (typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined))
}

// A router of its own, because the card's Sign in link needs one.
function openCard() {
  const rootRoute = createRootRoute({ component: JellyfinCard })
  const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
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

  expect(await screen.findByText(KEY_SAVED)).toBeDefined()
  expect(screen.getByText('Configured')).toBeDefined()
  expect(urlField().value).toBe(SAVED_URL)
  expect(keyField().value).toBe('')
  expect(keyField().type).toBe('password')
})

it('says when the saved key no longer decrypts', async () => {
  stubBackend({ get: [answer({ url: SAVED_URL, apiKeyState: 'UNREADABLE' })] })
  openCard()

  expect(await screen.findByText('Key unreadable')).toBeDefined()
  expect(screen.getByText(/can't read the saved key/)).toBeDefined()
})

it('shows the saved URL under a changed one', async () => {
  stubBackend({ get: [answer(STORED)] })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)

  expect(screen.getByText(`Saved: ${SAVED_URL}`)).toBeDefined()
  expect(screen.getByText('Unsaved changes')).toBeDefined()
})

it('shows a saved key as dots that are never the field value', async () => {
  stubBackend({ get: [answer(STORED)] })
  openCard()

  await screen.findByText(KEY_SAVED)

  expect(keyField().placeholder).toMatch(SAVED_KEY_DOTS)
  expect(keyField().value).toBe('')
})

it('keeps the saved key on a new URL for the same server, sending only the URL', async () => {
  stubBackend({ get: [answer(STORED)], patch: status(HTTP_NO_CONTENT) })
  openCard()

  type(await screen.findByLabelText('Server URL'), SAME_SERVER_URL)
  fireEvent.click(saveButton())

  expect(await screen.findByText('Saved. Continuarr uses this from now on.')).toBeDefined()
  expect(patchBodies()).toEqual([{ url: SAME_SERVER_URL }])
  expect(screen.getByText(KEY_SAVED)).toBeDefined()
})

it('asks before sending the saved key to a different server, and Cancel sends nothing', async () => {
  stubBackend({ get: [answer(STORED)], patch: status(HTTP_NO_CONTENT) })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)
  fireEvent.click(saveButton())

  expect(screen.getByText('Send the saved key to jf.example.net?')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByText('Send the saved key to jf.example.net?')).toBeNull()
  expect(patchBodies()).toHaveLength(0)
  expect(urlField().value).toBe(NEW_URL)

  fireEvent.click(saveButton())
  fireEvent.click(screen.getByRole('button', { name: 'Send saved key' }))

  expect(await screen.findByText('Saved. Continuarr uses this from now on.')).toBeDefined()
  expect(patchBodies()).toEqual([{ url: NEW_URL }])
})

it('needs the key again to move from https to http, and sends nothing until then', async () => {
  stubBackend({ get: [answer({ url: HTTPS_SAVED_URL, apiKeyState: 'STORED' })] })
  openCard()

  type(await screen.findByLabelText('Server URL'), SAVED_URL)
  fireEvent.click(saveButton())

  expect(screen.getByText(KEY_FOR_HTTP)).toBeDefined()
  expect(document.activeElement).toBe(keyField())
  expect(screen.getByText('Fix 1 field, then save again. Your entries are kept.')).toBeDefined()
  expect(screen.getByText('Configured')).toBeDefined()
  expect(patchBodies()).toHaveLength(0)
})

it('says the session ended when a save answers 401', async () => {
  stubBackend({ get: [answer(STORED)], patch: status(HTTP_UNAUTHORIZED) })
  openCard()

  type(await screen.findByLabelText('API key'), API_KEY)
  fireEvent.click(saveButton())

  expect(await screen.findByText('Your session ended.')).toBeDefined()
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  expect(screen.getByText('Configured')).toBeDefined()
})

it('says the session ended when a refetch answers 401 after settings loaded', async () => {
  stubBackend({ get: [answer(STORED), status(HTTP_UNAUTHORIZED)] })
  openCard()
  await screen.findByText(KEY_SAVED)

  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })

  expect(await screen.findByText('Your session ended.')).toBeDefined()
  expect(screen.queryByLabelText('Server URL')).toBeNull()
  act(() => focusManager.setFocused(undefined))
})

it('says the session ended when loading answers 401', async () => {
  stubBackend({ get: [status(HTTP_UNAUTHORIZED)] })
  openCard()

  expect(await screen.findByText('Your session ended.')).toBeDefined()
  expect(screen.getByRole('link', { name: 'Sign in' })).toBeDefined()
  expect(screen.queryByLabelText('Server URL')).toBeNull()
})

it('says there is nothing to save when nothing changed', async () => {
  stubBackend({ get: [answer(STORED)] })
  openCard()

  fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

  expect(screen.getByText('No changes to save.')).toBeDefined()
  expect(patchBodies()).toHaveLength(0)
})

it('saves trimmed values, clears the key, and reports the save', async () => {
  stubBackend({ get: [answer(NOTHING_SAVED)], patch: status(HTTP_NO_CONTENT) })
  openCard()

  type(await screen.findByLabelText('Server URL'), `  ${NEW_URL} `)
  type(keyField(), ` ${API_KEY}\n`)
  fireEvent.click(saveButton())

  expect(await screen.findByText('Saved. Continuarr uses this from now on.')).toBeDefined()
  expect(patchBodies()).toEqual([{ url: NEW_URL, apiKey: API_KEY }])
  expect(keyField().value).toBe('')
  expect(screen.getByText('Configured')).toBeDefined()
  expect(screen.getByText(KEY_SAVED)).toBeDefined()
})

it('puts its own message on each field a 400 names and keeps the saved pill', async () => {
  stubBackend({ get: [answer(STORED)], patch: refused })
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

it('turns Save off after a 503 until settings are reloaded', async () => {
  stubBackend({ get: [answer(NOTHING_SAVED)], patch: status(HTTP_SERVICE_UNAVAILABLE) })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)
  type(keyField(), API_KEY)
  fireEvent.click(saveButton())

  expect(await screen.findByText("Continuarr can't store the API key yet.")).toBeDefined()
  expect(screen.getByText('Save is off until the server can encrypt the key.')).toBeDefined()
  expect(screen.getByText('No key saved yet')).toBeDefined()
  expect(saveButton().getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(saveButton())
  expect(patchBodies()).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }))

  await waitFor(() => expect(saveButton().getAttribute('aria-disabled')).toBe('false'))
  expect(urlField().value).toBe(NEW_URL)
})

it('keeps a successful save when an older load lands after it', async () => {
  const slowLoad = deferred<Response>()
  let saves = 0
  const failThenSave: Respond = async () => status(++saves === 1 ? HTTP_SERVICE_UNAVAILABLE : HTTP_NO_CONTENT)()
  stubBackend({ get: [answer(NOTHING_SAVED), () => slowLoad.promise], patch: failThenSave })
  openCard()

  type(await screen.findByLabelText('Server URL'), NEW_URL)
  type(keyField(), API_KEY)
  fireEvent.click(saveButton())
  fireEvent.click(await screen.findByRole('button', { name: 'Reload settings' }))
  type(keyField(), API_KEY)
  fireEvent.click(saveButton())
  await screen.findByText('Saved. Continuarr uses this from now on.')
  await act(async () => {
    slowLoad.resolve(Response.json(NOTHING_SAVED))
    await new Promise((resolve) => {
      setTimeout(resolve, LOAD_SETTLE_MS)
    })
  })

  expect(screen.getByText('Configured')).toBeDefined()
  expect(screen.getByText(KEY_SAVED)).toBeDefined()
  expect(screen.queryByText('Not configured')).toBeNull()
})

it.each([
  { failure: 'a 500', patch: status(HTTP_INTERNAL_SERVER_ERROR) },
  { failure: 'a network error', patch: unreachable },
])('keeps the entries and offers Try again after $failure', async ({ patch }) => {
  stubBackend({ get: [answer(STORED)], patch })
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

  await waitFor(() => expect(patchBodies()).toEqual([sentBody, sentBody]))
})

it('shows a failed load as unknown and loads again on Retry', async () => {
  stubBackend({ get: [status(HTTP_INTERNAL_SERVER_ERROR), answer(STORED)] })
  openCard()

  expect(await screen.findByText("Couldn't load settings.")).toBeDefined()
  expect(screen.getByText('Unknown')).toBeDefined()
  expect(screen.queryByLabelText('Server URL')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

  expect(await screen.findByText(KEY_SAVED)).toBeDefined()
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
