// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CSRF_COOKIE_NAME, LOGOUT_PATH, SESSION_PATH, SETUP_PATH } from '../api/client.ts'
import { queryClient } from '../queryClient.ts'
import { routeTree } from '../router.tsx'

const HTTP_NO_CONTENT = 204
const HTTP_FORBIDDEN = 403
const HTTP_UNAUTHORIZED = 401
const USERNAME = 'admin'

type Respond = () => Promise<Response>

const fetchMock = vi.fn<typeof fetch>()

function stubBackend(routes: Record<string, Respond>) {
  fetchMock.mockImplementation((input, init) => {
    const respond = routes[`${init?.method ?? 'GET'} ${String(input)}`]
    return respond ? respond() : Promise.reject(new Error(`Unexpected request to ${String(input)}`))
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
  return fetchMock.mock.calls.filter(([input, init]) => String(input) === LOGOUT_PATH && init?.method === 'POST')
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
  stubBackend({ [`GET ${SESSION_PATH}`]: signedOut, [`GET ${SETUP_PATH}`]: setupDone })

  const router = openShell()

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/login')
})

it('signs out and returns to the login page', async () => {
  stubBackend({
    [`GET ${SESSION_PATH}`]: signedIn,
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
    [`GET ${SESSION_PATH}`]: signedIn,
    [`POST ${LOGOUT_PATH}`]: respond,
    [`GET ${SETUP_PATH}`]: setupDone,
  })
  const router = openShell()

  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/login')
})
