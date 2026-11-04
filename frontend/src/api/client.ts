// The one way pages call the backend: same-origin fetch with the session cookie and Spring
// Security's SPA CSRF token. See docs/plan.md#security.

import type { components } from './schema'

export const CSRF_COOKIE_NAME = 'XSRF-TOKEN'
export const CSRF_HEADER_NAME = 'X-XSRF-TOKEN'
export const CSRF_PATH = '/api/csrf'
export const LOGIN_PATH = '/api/login'
export const LOGOUT_PATH = '/api/logout'
export const SETUP_PATH = '/api/setup'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const STATE_CHANGING_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type ApiRequestInit = Omit<RequestInit, 'method' | 'credentials'> & { method?: HttpMethod }

export interface Credentials {
  username: string
  password: string
}

export type SetupRequest = components['schemas']['SetupRequest']
export type SetupStatus = components['schemas']['SetupStatus']

/**
 * Sends a request to the backend. State-changing methods carry the CSRF token, fetching it
 * first if this browser has none yet.
 */
export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET'
  const headers = new Headers(init.headers)
  if (STATE_CHANGING_METHODS.has(method)) {
    headers.set(CSRF_HEADER_NAME, await csrfToken())
  }
  return fetch(path, { ...init, method, headers, credentials: 'same-origin' })
}

/** Form login; answers 204 on success and 401 on bad credentials. */
export function login({ username, password }: Credentials): Promise<Response> {
  return apiFetch(LOGIN_PATH, { method: 'POST', body: new URLSearchParams({ username, password }) })
}

export function logout(): Promise<Response> {
  return apiFetch(LOGOUT_PATH, { method: 'POST' })
}

/** Whether the admin still has to be created; anyone may ask. */
export async function fetchSetupStatus(): Promise<SetupStatus> {
  const response = await apiFetch(SETUP_PATH)
  if (!response.ok) {
    throw new Error(`GET ${SETUP_PATH} returned ${response.status}`)
  }
  // The shape is checked by the generated types and the backend's OpenApiSpecTest.
  return (await response.json()) as SetupStatus
}

/** Creates the admin; answers 204, or 400, 403, or 409 as documented in openapi.json. */
export function setUp(request: SetupRequest): Promise<Response> {
  return apiFetch(SETUP_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

// Read from the cookie on every request rather than cached: Spring rotates the token on login
// and logout, and the browser's cookie is always the current one.
async function csrfToken(): Promise<string> {
  const existing = readCsrfCookie()
  if (existing) return existing

  // csrf.spa() defers the token, so nothing writes the cookie until this endpoint reads it.
  const response = await fetch(CSRF_PATH, { credentials: 'same-origin' })
  const token = readCsrfCookie()
  if (!response.ok || !token) {
    throw new Error(`GET ${CSRF_PATH} returned ${response.status} without a ${CSRF_COOKIE_NAME} cookie`)
  }
  return token
}

function readCsrfCookie(): string | undefined {
  const prefix = `${CSRF_COOKIE_NAME}=`
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(prefix))
  const value = cookie?.slice(prefix.length)
  return value ? decodeURIComponent(value) : undefined
}
