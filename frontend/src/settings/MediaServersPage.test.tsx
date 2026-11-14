// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  CSRF_COOKIE_NAME,
  JELLYFIN_CONNECTION_PATH,
  PLEX_CONNECTION_PATH,
  type JellyfinConnection,
  type PlexConnection,
} from '../api/client.ts'
import { MEDIA_SERVERS_PATH, MediaServersPage } from './MediaServersPage.tsx'

const JELLYFIN_URL = 'http://jellyfin.home.lan:8096'
const EDITED_URL = 'https://jf.example.net'
const PLEX_URL = 'http://plex.home.lan:32400'
const HTTP_NO_CONTENT = 204
const HTTP_INTERNAL_SERVER_ERROR = 500
const FIRST_LOAD = 1
const LOAD_AND_RELOAD = 2
// Long enough for a request loop, if there were one, to send many more requests.
const SETTLE_MS = 200

const JELLYFIN_NONE: JellyfinConnection = { url: null, apiKeyState: 'NONE' }
const JELLYFIN_STORED: JellyfinConnection = { url: JELLYFIN_URL, apiKeyState: 'STORED' }
const PLEX_NONE: PlexConnection = { url: null, source: null, tokenState: 'NONE' }
const PLEX_LINKED: PlexConnection = { url: PLEX_URL, source: 'PLEX_TV', tokenState: 'STORED' }

const notYetSet = (): void => undefined

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()

function stubBackend(jellyfin: JellyfinConnection, plex: PlexConnection | 'fails') {
  fetchMock.mockImplementation(async (path, init) => {
    if (init?.method === 'DELETE' && path === PLEX_CONNECTION_PATH) return new Response(null, { status: HTTP_NO_CONTENT })
    if (path === JELLYFIN_CONNECTION_PATH) return Response.json(jellyfin)
    if (path === PLEX_CONNECTION_PATH) {
      return plex === 'fails' ? new Response(null, { status: HTTP_INTERNAL_SERVER_ERROR }) : Response.json(plex)
    }
    throw new Error(`Unexpected request to ${path}`)
  })
}

const reads = (path: string) =>
  fetchMock.mock.calls.filter(([called, init]) => called === path && init?.method === 'GET').length
const heading = (name: string) => screen.queryByRole('heading', { level: 2, name })
const button = (name: string) => screen.getByRole('button', { name })

function openPage() {
  const rootRoute = createRootRoute()
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: MEDIA_SERVERS_PATH, component: MediaServersPage })
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [MEDIA_SERVERS_PATH] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('scrollTo', vi.fn())
  // jsdom has no popover API.
  HTMLElement.prototype.hidePopover = vi.fn<HTMLElement['hidePopover']>()
  document.cookie = `${CSRF_COOKIE_NAME}=token; path=/`
})

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`
  vi.unstubAllGlobals()
})

it('shows no card for a server that has nothing saved, and offers both in Add server', async () => {
  stubBackend(JELLYFIN_NONE, PLEX_NONE)
  openPage()

  expect(await screen.findByText('No media servers yet.')).toBeDefined()
  expect(heading('Jellyfin')).toBeNull()
  expect(heading('Plex')).toBeNull()
  expect(screen.getByRole('button', { name: 'Jellyfin', hidden: true })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Plex', hidden: true })).toBeDefined()
})

it('shows each configured server, and Add server offers only the rest', async () => {
  stubBackend(JELLYFIN_STORED, PLEX_NONE)
  openPage()

  expect(await screen.findByRole('heading', { level: 2, name: 'Jellyfin' })).toBeDefined()
  expect(heading('Plex')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Jellyfin', hidden: true })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Plex', hidden: true }))

  expect(document.activeElement).toBe(heading('Plex'))
  expect(screen.getByText('Not linked')).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Add server' })).toBeNull()
})

it('shows the card of a server whose settings failed to load, so it never looks unconfigured', async () => {
  stubBackend(JELLYFIN_STORED, 'fails')
  openPage()

  expect(await screen.findByText("Couldn't load settings.")).toBeDefined()
  expect(heading('Plex')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Plex', hidden: true })).toBeNull()
  await new Promise((settle) => {
    setTimeout(settle, SETTLE_MS)
  })
  expect(reads(PLEX_CONNECTION_PATH)).toBe(FIRST_LOAD)
})

it('keeps a failed card on screen while Retry loads it again', async () => {
  stubBackend(JELLYFIN_STORED, 'fails')
  openPage()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  let answerRetry: (response: Response) => void = notYetSet
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((settle) => {
        answerRetry = settle
      }),
  )

  fireEvent.click(retry)
  await waitFor(() => expect(reads(PLEX_CONNECTION_PATH)).toBe(LOAD_AND_RELOAD))
  await new Promise((settle) => {
    setTimeout(settle, SETTLE_MS)
  })

  expect(heading('Plex')).not.toBeNull()
  answerRetry(Response.json(PLEX_LINKED))
  expect(await screen.findByText('Linked')).toBeDefined()
})

it('reloads without asking when nothing is unsaved', async () => {
  stubBackend(JELLYFIN_STORED, PLEX_LINKED)
  openPage()
  await screen.findByRole('heading', { level: 2, name: 'Plex' })

  fireEvent.click(button('Reload'))

  await waitFor(() => expect(reads(PLEX_CONNECTION_PATH)).toBe(LOAD_AND_RELOAD))
  expect(reads(JELLYFIN_CONNECTION_PATH)).toBe(LOAD_AND_RELOAD)
  expect(screen.queryByText(/Discard unsaved changes/)).toBeNull()
})

it('asks before Reload discards unsaved edits, and Cancel keeps them', async () => {
  stubBackend(JELLYFIN_STORED, PLEX_LINKED)
  openPage()
  const url = await screen.findByLabelText<HTMLInputElement>('Server URL')
  fireEvent.change(url, { target: { value: EDITED_URL } })

  fireEvent.click(button('Reload'))
  expect(screen.getByText('Discard unsaved changes to Jellyfin?')).toBeDefined()
  fireEvent.click(button('Cancel'))

  expect(screen.getByLabelText<HTMLInputElement>('Server URL').value).toBe(EDITED_URL)
  expect(document.activeElement).toBe(button('Reload'))
  expect(reads(JELLYFIN_CONNECTION_PATH)).toBe(FIRST_LOAD)
})

it('puts the saved values back when the admin discards their edits', async () => {
  stubBackend(JELLYFIN_STORED, PLEX_LINKED)
  openPage()
  fireEvent.change(await screen.findByLabelText('Server URL'), { target: { value: EDITED_URL } })

  fireEvent.click(button('Reload'))
  fireEvent.click(button('Discard changes'))

  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Server URL').value).toBe(JELLYFIN_URL))
  expect(reads(JELLYFIN_CONNECTION_PATH)).toBe(LOAD_AND_RELOAD)
  expect(screen.queryByText('Discard unsaved changes to Jellyfin?')).toBeNull()
})

it('keeps edits and says so when Reload fails', async () => {
  stubBackend(JELLYFIN_STORED, PLEX_LINKED)
  openPage()
  fireEvent.change(await screen.findByLabelText('Server URL'), { target: { value: EDITED_URL } })
  stubBackend(JELLYFIN_STORED, 'fails')

  fireEvent.click(button('Reload'))
  fireEvent.click(button('Discard changes'))

  expect(await screen.findByText("Couldn't reload settings.")).toBeDefined()
  expect(screen.getByLabelText<HTMLInputElement>('Server URL').value).toBe(EDITED_URL)
})

it('asks about edits typed while Reload was loading instead of dropping them', async () => {
  stubBackend(JELLYFIN_STORED, PLEX_LINKED)
  openPage()
  const url = await screen.findByLabelText<HTMLInputElement>('Server URL')

  fireEvent.click(button('Reload'))
  fireEvent.change(url, { target: { value: EDITED_URL } })

  expect(await screen.findByText('Discard unsaved changes to Jellyfin?')).toBeDefined()
  expect(screen.getByLabelText<HTMLInputElement>('Server URL').value).toBe(EDITED_URL)
})

it('keeps the Plex card after Unlink, showing it as not linked', async () => {
  stubBackend(JELLYFIN_STORED, PLEX_LINKED)
  openPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
  fireEvent.click(button('Unlink'))

  expect(await screen.findByText('Not linked')).toBeDefined()
  expect(heading('Plex')).not.toBeNull()
})
