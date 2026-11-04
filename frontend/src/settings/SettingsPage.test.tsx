// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTH_PATH, CSRF_COOKIE_NAME, JELLYFIN_CONNECTION_PATH } from '../api/client.ts'
import { queryClient } from '../queryClient.ts'
import { routeTree } from '../router.tsx'
import { SettingsScreen } from './SettingsPage.tsx'

const HTTP_NO_CONTENT = 204
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_INTERNAL_SERVER_ERROR = 500
const HTTP_SERVICE_UNAVAILABLE = 503
const TYPED_URL = 'http://jellyfin.local:8096'
const STORED_URL = 'https://jellyfin.example.com'
const OTHER_TAB_URL = 'https://other-tab.example.com'
const API_KEY = 'dummy-key-0123'
const KEY_MESSAGE = /It can't contain spaces, quotes, or backslashes/
const USERNAME = 'admin'

const fetchMock = vi.fn<typeof fetch>()
let storedUrl: string | null = null

function stubBackend(saveStatus: number, saveBody: unknown = null) {
  fetchMock.mockImplementation(async (input, init) => {
    const route = `${init?.method ?? 'GET'} ${String(input)}`
    if (route === `GET ${AUTH_PATH}`) return Response.json({ username: USERNAME })
    if (route === `GET ${JELLYFIN_CONNECTION_PATH}`) return Response.json({ url: storedUrl })
    if (route === `PUT ${JELLYFIN_CONNECTION_PATH}`) {
      if (saveStatus === HTTP_NO_CONTENT) storedUrl = STORED_URL
      return saveBody === null ? new Response(null, { status: saveStatus }) : Response.json(saveBody, { status: saveStatus })
    }
    throw new Error(`Unexpected request to ${route}`)
  })
}

function connectionReads(): number {
  return fetchMock.mock.calls.filter(([input, init]) => String(input) === JELLYFIN_CONNECTION_PATH && init?.method === 'GET').length
}

function openSettings() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/settings'] }) })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

async function save(url: string) {
  fireEvent.change(await screen.findByLabelText('Server URL'), { target: { value: url } })
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: API_KEY } })
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
}

beforeEach(() => {
  storedUrl = null
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('scrollTo', vi.fn())
  document.cookie = `${CSRF_COOKIE_NAME}=token; path=/`
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  fetchMock.mockReset()
  document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`
  vi.unstubAllGlobals()
})

it('shows the URL read back from the server and clears the key after a save', async () => {
  stubBackend(HTTP_NO_CONTENT)
  openSettings()

  await save(TYPED_URL)

  const saved = await screen.findByRole('region', { name: 'Saved connection' })
  expect(await within(saved).findByText(STORED_URL)).toBeDefined()
  expect(within(saved).getByText('Stored')).toBeDefined()
  expect((screen.getByLabelText('Server URL') as HTMLInputElement).value).toBe(STORED_URL)
  expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('')
})

it('keeps focus in the key field after a save submitted with Enter from it', async () => {
  stubBackend(HTTP_NO_CONTENT)
  openSettings()
  fireEvent.change(await screen.findByLabelText('Server URL'), { target: { value: TYPED_URL } })
  const apiKey = screen.getByLabelText('API key')
  fireEvent.change(apiKey, { target: { value: API_KEY } })
  apiKey.focus()

  fireEvent.submit(screen.getByRole('form', { name: 'Jellyfin connection' }))

  await within(screen.getByRole('region', { name: 'Saved connection' })).findByText(STORED_URL)
  expect(document.activeElement).toBe(screen.getByLabelText('API key'))
})

it('keeps what the admin typed when the window regains focus', async () => {
  stubBackend(HTTP_NO_CONTENT)
  openSettings()
  fireEvent.change(await screen.findByLabelText('Server URL'), { target: { value: TYPED_URL } })

  await act(async () => {
    window.dispatchEvent(new Event('visibilitychange'))
  })

  expect(connectionReads()).toBe(1)
  expect((screen.getByLabelText('Server URL') as HTMLInputElement).value).toBe(TYPED_URL)
})

it('starts the URL field from the current saved URL when the admin comes back to the page', async () => {
  stubBackend(HTTP_NO_CONTENT)
  storedUrl = STORED_URL
  const router = openSettings()
  await screen.findByDisplayValue(STORED_URL)
  await act(async () => {
    await router.navigate({ to: '/' })
  })
  storedUrl = OTHER_TAB_URL

  await act(async () => {
    await router.navigate({ to: '/settings' })
  })

  await within(await screen.findByRole('region', { name: 'Saved connection' })).findByText(OTHER_TAB_URL)
  expect((screen.getByLabelText('Server URL') as HTMLInputElement).value).toBe(OTHER_TAB_URL)
})

it('shows the key message under the key field when the 400 names it', async () => {
  stubBackend(HTTP_BAD_REQUEST, { invalidFields: ['API_KEY'] })
  openSettings()

  await save(TYPED_URL)

  const apiKey = await screen.findByLabelText('API key')
  await waitFor(() => expect(apiKey.getAttribute('aria-invalid')).toBe('true'))
  expect(document.getElementById(apiKey.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(KEY_MESSAGE)
  expect(screen.getByLabelText('Server URL').getAttribute('aria-invalid')).toBe('false')
})

it.each([
  { status: HTTP_SERVICE_UNAVAILABLE, message: /CONTINUARR_ENCRYPTION_KEY isn't set/ },
  { status: HTTP_UNAUTHORIZED, message: /Your session ended/ },
  { status: HTTP_INTERNAL_SERVER_ERROR, message: /Couldn't save the connection/ },
])('explains a $status from the save', async ({ status, message }) => {
  stubBackend(status)
  openSettings()

  await save(TYPED_URL)

  expect(await screen.findByText(message)).toBeDefined()
})

it('says nothing is saved yet and leaves the URL empty', () => {
  render(
    <SettingsScreen
      load={{ status: 'loaded', connection: null }}
      confirmedSaves={0}
      submitting={false}
      outcome={undefined}
      onSave={() => undefined}
    />,
  )

  expect(screen.getByText('Nothing saved yet.')).toBeDefined()
  expect((screen.getByLabelText('Server URL') as HTMLInputElement).value).toBe('')
})

it('says so when the saved connection cannot be loaded', () => {
  render(<SettingsScreen load={{ status: 'failed' }} confirmedSaves={0} submitting={false} outcome={undefined} onSave={() => undefined} />)

  expect(screen.getByRole('alert').textContent).toMatch(/Couldn't load the saved connection/)
  expect(screen.queryByRole('form')).toBeNull()
})
