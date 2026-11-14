// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CSRF_COOKIE_NAME, SETUP_PATH } from '../api/client.ts'
import { queryClient } from '../queryClient.ts'
import { routeTree } from '../router.tsx'

const SETUP_TOKEN = '3f9c0b1e8d2a4c6f7e5b9a1d0c3e2f4a'
const PASSWORD = 'correct-horse-battery'
const WRONG_TOKEN_MESSAGE = /That setup token doesn't match/
const HTTP_NO_CONTENT = 204
const HTTP_FORBIDDEN = 403

beforeEach(() => {
  // The router restores scroll on navigation, and jsdom has no scrollTo.
  vi.stubGlobal('scrollTo', vi.fn())
  document.cookie = `${CSRF_COOKIE_NAME}=token; path=/`
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.unstubAllGlobals()
})

/** Serves a fresh install whose POST /api/setup answers with `status`, which creates the admin when it is 204. */
function openSetup(status: number) {
  let adminExists = false
  // apiFetch only ever passes fetch a path string.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const call = `${init?.method ?? 'GET'} ${path}`
      if (call === `GET ${SETUP_PATH}`) return Response.json({ required: !adminExists })
      if (call === `POST ${SETUP_PATH}`) {
        adminExists = status === HTTP_NO_CONTENT
        return new Response(null, { status })
      }
      throw new Error(`Unexpected ${call}`)
    }),
  )
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/setup'] }) })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function createAdmin() {
  fireEvent.change(screen.getByLabelText('Setup token'), { target: { value: SETUP_TOKEN } })
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: PASSWORD } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Create admin' }))
}

function cachedMutationVariables(): string {
  return JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.variables))
}

it('keeps no copy of the setup token or password once the admin is created', async () => {
  openSetup(HTTP_NO_CONTENT)
  await screen.findByLabelText('Setup token')
  createAdmin()

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDefined()
  expect(cachedMutationVariables()).not.toContain(SETUP_TOKEN)
  expect(cachedMutationVariables()).not.toContain(PASSWORD)
})

it('keeps no copy of the setup token or password once setup is refused', async () => {
  openSetup(HTTP_FORBIDDEN)
  await screen.findByLabelText('Setup token')
  createAdmin()

  expect(await screen.findByText(WRONG_TOKEN_MESSAGE)).toBeDefined()
  expect(cachedMutationVariables()).not.toContain(SETUP_TOKEN)
  expect(cachedMutationVariables()).not.toContain(PASSWORD)
})
