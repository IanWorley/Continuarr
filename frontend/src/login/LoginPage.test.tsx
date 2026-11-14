// @vitest-environment jsdom
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AUTH_PATH, CSRF_COOKIE_NAME, LOGIN_PATH, SETUP_PATH } from '../api/client.ts'
import { queryClient } from '../queryClient.ts'
import { routeTree } from '../router.tsx'

const UNREACHABLE_MESSAGE = /Couldn't reach Continuarr/
const SIGNING_IN_LABEL = 'Signing in…'
const BAD_CREDENTIALS_MESSAGE = 'Wrong username or password'
const PASSWORD = 'correct-horse-battery'
const HTTP_NO_CONTENT = 204
const HTTP_UNAUTHORIZED = 401

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))
  // The router restores scroll on navigation, and jsdom has no scrollTo.
  vi.stubGlobal('scrollTo', vi.fn())
  document.cookie = `${CSRF_COOKIE_NAME}=token; path=/`
})

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  queryClient.clear()
  vi.unstubAllGlobals()
})

/** Answers each `METHOD path` with its handler, and fails the test on any other request. */
function stubServer(routes: Record<string, () => Response>) {
  // apiFetch only ever passes fetch a path string.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const call = `${init?.method ?? 'GET'} ${path}`
      const respond = routes[call]
      if (!respond) throw new Error(`Unexpected ${call}`)
      return respond()
    }),
  )
}

async function signIn(password: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/login'] }) })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

function cachedMutationVariables(): string {
  return JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.variables))
}

it('keeps no copy of the password once sign-in succeeds', async () => {
  let signedIn = false
  stubServer({
    [`GET ${SETUP_PATH}`]: () => Response.json({ required: false }),
    [`POST ${LOGIN_PATH}`]: () => {
      signedIn = true
      return new Response(null, { status: HTTP_NO_CONTENT })
    },
    [`GET ${AUTH_PATH}`]: () =>
      signedIn ? Response.json({ username: 'admin' }) : new Response(null, { status: HTTP_UNAUTHORIZED }),
  })
  await signIn(PASSWORD)

  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeDefined()
  expect(cachedMutationVariables()).not.toContain(PASSWORD)
})

it('keeps no copy of the password once a sign-in is refused', async () => {
  stubServer({
    [`GET ${SETUP_PATH}`]: () => Response.json({ required: false }),
    [`POST ${LOGIN_PATH}`]: () => new Response(null, { status: HTTP_UNAUTHORIZED }),
  })
  await signIn(PASSWORD)

  expect(await screen.findByText(BAD_CREDENTIALS_MESSAGE)).toBeDefined()
  expect(cachedMutationVariables()).not.toContain(PASSWORD)
})

it('reports an unreachable server instead of pausing while the browser says it is offline', async () => {
  onlineManager.setOnline(false)
  await signIn('secret')

  expect(await screen.findByText(UNREACHABLE_MESSAGE)).toBeDefined()
  expect(screen.queryByText(SIGNING_IN_LABEL)).toBeNull()
})
