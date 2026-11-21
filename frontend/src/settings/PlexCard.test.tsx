// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CSRF_COOKIE_NAME, PLEX_CONNECTION_PATH, type PlexConnection } from '../api/client.ts'
import { PlexCard } from './PlexCard.tsx'

const SAVED_URL = 'http://plex.home.lan:32400'
const HTTP_NO_CONTENT = 204
const HTTP_INTERNAL_SERVER_ERROR = 500

const NOTHING_SAVED: PlexConnection = { url: null, source: null, tokenState: 'NONE' }
const LINKED: PlexConnection = { url: SAVED_URL, source: 'PLEX_TV', tokenState: 'STORED' }
const EXPIRED: PlexConnection = { url: SAVED_URL, source: 'PLEX_TV', tokenState: 'NONE' }

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()

function stubBackend(saved: PlexConnection, unlinkStatus = HTTP_NO_CONTENT) {
  fetchMock.mockImplementation(async (path, init) => {
    if (path !== PLEX_CONNECTION_PATH) throw new Error(`Unexpected request to ${path}`)
    return init?.method === 'DELETE' ? new Response(null, { status: unlinkStatus }) : Response.json(saved)
  })
}

const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
const button = (name: string) => screen.getByRole('button', { name })

function openCard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlexCard />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  document.cookie = `${CSRF_COOKIE_NAME}=token; path=/`
})

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`
  vi.unstubAllGlobals()
})

it('shows nothing saved as not linked, with linking marked as coming later', async () => {
  stubBackend(NOTHING_SAVED)
  openCard()

  expect(await screen.findByText('Not linked')).toBeDefined()
  expect(button('Link with plex.tv').getAttribute('aria-disabled')).toBe('true')
  expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull()
})

it('shows a saved URL with no token as an expired link to re-link', async () => {
  stubBackend(EXPIRED)
  openCard()

  expect(await screen.findByText('Your Plex link expired.')).toBeDefined()
  expect(screen.getByText('Re-link needed')).toBeDefined()
  expect(button('Re-link with plex.tv').getAttribute('aria-disabled')).toBe('true')
})

it('asks before it unlinks, and Cancel sends nothing', async () => {
  stubBackend(LINKED)
  openCard()

  fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
  expect(screen.getByText('Unlink Plex?')).toBeDefined()
  expect(document.activeElement).toBe(button('Cancel'))
  fireEvent.click(button('Cancel'))

  expect(screen.queryByText('Unlink Plex?')).toBeNull()
  expect(document.activeElement).toBe(button('Unlink'))
  expect(deletes()).toHaveLength(0)
})

it('unlinks after the confirm and shows Plex as not linked', async () => {
  stubBackend(LINKED)
  openCard()

  fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
  fireEvent.click(button('Unlink'))

  expect(await screen.findByText('Unlinked. Continuarr no longer reads from this server.')).toBeDefined()
  expect(screen.getByText('Not linked')).toBeDefined()
  expect(deletes()).toHaveLength(1)
})

it('ignores Cancel while Unlink runs, so only one request goes out', async () => {
  stubBackend(LINKED)
  openCard()
  fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
  fireEvent.click(button('Unlink'))

  fireEvent.click(button('Cancel'))

  expect(screen.getByText('Unlink Plex?')).toBeDefined()
  expect(await screen.findByText('Not linked')).toBeDefined()
  expect(deletes()).toHaveLength(1)
})

it('keeps the link and offers Try again when Unlink fails', async () => {
  stubBackend(LINKED, HTTP_INTERNAL_SERVER_ERROR)
  openCard()

  fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
  fireEvent.click(button('Unlink'))

  expect(await screen.findByText("Couldn't unlink Plex.")).toBeDefined()
  expect(screen.getByText('Linked')).toBeDefined()
  expect(button('Try again')).toBeDefined()
})
