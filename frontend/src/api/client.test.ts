// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, CSRF_PATH, login, LOGIN_PATH } from './client.ts'

const TOKEN = 'token-before-login'
const ROTATED_TOKEN = 'token-after-login'
const STATE_CHANGING_PATH = '/api/things'
const NO_CONTENT = 204

const fetchMock = vi.fn<typeof fetch>()

function setCsrfCookie(value: string) {
  document.cookie = `${CSRF_COOKIE_NAME}=${value}; path=/`
}

function clearCsrfCookie() {
  document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`
}

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input))
}

function headerSentTo(path: string): string | null {
  const call = fetchMock.mock.calls.find(([input]) => String(input) === path)
  return new Headers(call?.[1]?.headers).get(CSRF_HEADER_NAME)
}

beforeEach(() => {
  fetchMock.mockResolvedValue(new Response(null, { status: NO_CONTENT }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  clearCsrfCookie()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('sends the cookie token as the CSRF header on a state-changing request', async () => {
    setCsrfCookie(TOKEN)

    await apiFetch(STATE_CHANGING_PATH, { method: 'DELETE' })

    expect(headerSentTo(STATE_CHANGING_PATH)).toBe(TOKEN)
  })

  it('fetches the CSRF cookie first when the browser has none', async () => {
    fetchMock.mockImplementationOnce(async () => {
      setCsrfCookie(TOKEN)
      return new Response(null, { status: NO_CONTENT })
    })

    await apiFetch(STATE_CHANGING_PATH, { method: 'POST' })

    expect(requestedPaths()).toEqual([CSRF_PATH, STATE_CHANGING_PATH])
    expect(headerSentTo(STATE_CHANGING_PATH)).toBe(TOKEN)
  })

  it('does not fetch the CSRF cookie when the browser already has one', async () => {
    setCsrfCookie(TOKEN)

    await apiFetch(STATE_CHANGING_PATH, { method: 'POST' })

    expect(requestedPaths()).toEqual([STATE_CHANGING_PATH])
  })

  it('uses the rotated token after login', async () => {
    setCsrfCookie(TOKEN)
    // Spring Security answers a successful login with a new XSRF-TOKEN cookie.
    fetchMock.mockImplementationOnce(async () => {
      setCsrfCookie(ROTATED_TOKEN)
      return new Response(null, { status: NO_CONTENT })
    })

    await login({ username: 'admin', password: 'password' })
    await apiFetch(STATE_CHANGING_PATH, { method: 'POST' })

    expect(requestedPaths()).toEqual([LOGIN_PATH, STATE_CHANGING_PATH])
    expect(headerSentTo(STATE_CHANGING_PATH)).toBe(ROTATED_TOKEN)
  })
})
