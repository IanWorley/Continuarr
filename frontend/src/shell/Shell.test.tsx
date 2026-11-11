// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTH_PATH, CSRF_COOKIE_NAME, LOGOUT_PATH, SETUP_PATH } from '../api/client.ts'
import { queryClient } from '../queryClient.ts'
import { routeTree } from '../router.tsx'

const MEDIA_SERVERS_PATH = '/settings/media-servers'
const HTTP_NO_CONTENT = 204
const HTTP_FORBIDDEN = 403
const HTTP_UNAUTHORIZED = 401
const USERNAME = 'admin'

type Respond = () => Promise<Response>

// apiFetch only ever passes fetch a path string.
const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()

function stubBackend(routes: Record<string, Respond>) {
  fetchMock.mockImplementation((path, init) => {
    const respond = routes[`${init?.method ?? 'GET'} ${path}`]
    return respond ? respond() : Promise.reject(new Error(`Unexpected request to ${path}`))
  })
}

const signedIn: Respond = async () => Response.json({ username: USERNAME })
const signedOut: Respond = async () => new Response(null, { status: HTTP_UNAUTHORIZED })
const setupDone: Respond = async () => Response.json({ required: false })
const noContent: Respond = async () => new Response(null, { status: HTTP_NO_CONTENT })
const refused: Respond = async () => new Response(null, { status: HTTP_FORBIDDEN })
const unreachable: Respond = async () => {
  throw new TypeError('Failed to fetch')
}

function logoutRequests() {
  return fetchMock.mock.calls.filter(([path, init]) => path === LOGOUT_PATH && init?.method === 'POST')
}

// A fresh router per test, because the app's shared router stops resolving navigation once an
// earlier test has unmounted it.
function openShell() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // The router restores scroll on navigation, and jsdom doesn't implement scrollTo.
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

it('sends a visitor without a session to the login page', async () => {
  stubBackend({ [`GET ${AUTH_PATH}`]: signedOut, [`GET ${SETUP_PATH}`]: setupDone })

  const router = openShell()

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/login')
})

it('signs out and returns to the login page', async () => {
  stubBackend({
    [`GET ${AUTH_PATH}`]: signedIn,
    [`POST ${LOGOUT_PATH}`]: noContent,
    [`GET ${SETUP_PATH}`]: setupDone,
  })
  openShell()

  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDefined()
  expect(logoutRequests()).toHaveLength(1)
})

it.each([
  { failure: 'a 403', respond: refused },
  { failure: 'a network error', respond: unreachable },
])('returns to the login page after $failure on sign-out', async ({ respond }) => {
  stubBackend({
    [`GET ${AUTH_PATH}`]: signedIn,
    [`POST ${LOGOUT_PATH}`]: respond,
    [`GET ${SETUP_PATH}`]: setupDone,
  })
  const router = openShell()

  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/login')
})

it('opens home at the media servers settings', async () => {
  stubBackend({ [`GET ${AUTH_PATH}`]: signedIn })

  const router = openShell()

  expect(await screen.findByRole('heading', { name: 'Media servers' })).toBeDefined()
  expect(router.state.location.pathname).toBe(MEDIA_SERVERS_PATH)
})

async function openDrawer() {
  stubBackend({ [`GET ${AUTH_PATH}`]: signedIn })
  openShell()
  fireEvent.click(await screen.findByRole('button', { name: 'Open navigation' }))
  const drawer = screen.getByRole('navigation', { name: 'Main menu' })
  return {
    drawer,
    hamburger: screen.getByRole('button', { name: 'Close navigation' }),
    settings: within(drawer).getByRole('link', { name: 'Settings' }),
  }
}

it('opens the drawer over a page that is inert and locked from scrolling', async () => {
  const { hamburger, settings } = await openDrawer()

  expect(hamburger.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(settings)
  expect(screen.getByRole('main').hasAttribute('inert')).toBe(true)
  expect(screen.getByRole('button', { name: 'Sign out' }).closest('[inert]')).not.toBeNull()
  expect(document.documentElement.classList.contains('drawer-open')).toBe(true)
})

it('closes the drawer on Escape and returns focus to the hamburger', async () => {
  const { drawer, hamburger } = await openDrawer()

  fireEvent.keyDown(document, { key: 'Escape' })

  expect(drawer.hidden).toBe(true)
  expect(document.activeElement).toBe(hamburger)
  expect(hamburger.getAttribute('aria-label')).toBe('Open navigation')
  expect(screen.getByRole('main').hasAttribute('inert')).toBe(false)
  expect(document.documentElement.classList.contains('drawer-open')).toBe(false)
})

it('keeps Tab on the hamburger and the drawer links while the drawer is open', async () => {
  const { hamburger, settings } = await openDrawer()

  fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(hamburger)

  fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(settings)

  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(hamburger)
})

it('closes the drawer when a destination is chosen', async () => {
  const { drawer, hamburger, settings } = await openDrawer()

  fireEvent.click(settings)

  expect(drawer.hidden).toBe(true)
  expect(document.activeElement).toBe(hamburger)
})
