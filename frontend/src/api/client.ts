// The one way pages call the backend: same-origin fetch with the session cookie and Spring
// Security's SPA CSRF token. See docs/plan.md#security.

import type { components } from './schema'

export const CSRF_COOKIE_NAME = 'XSRF-TOKEN'
export const CSRF_HEADER_NAME = 'X-XSRF-TOKEN'
export const AUTH_PATH = '/api/v1/auth'
export const CSRF_PATH = '/api/csrf'
export const LOGIN_PATH = '/api/login'
export const LOGOUT_PATH = '/api/logout'
export const SETUP_PATH = '/api/setup'
export const JELLYFIN_CONNECTION_PATH = '/api/v1/jellyfin/connection'
export const API_TIMEOUT_MS = 10_000

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const STATE_CHANGING_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type ApiRequestInit = Omit<RequestInit, 'method' | 'credentials' | 'signal'> & { method?: HttpMethod }

export interface Credentials {
  username: string
  password: string
}

export type Session = components['schemas']['Session']
export type SetupRequest = components['schemas']['SetupRequest']
export type SetupStatus = components['schemas']['SetupStatus']
export type JellyfinConnection = components['schemas']['JellyfinConnectionResponse']
export type JellyfinConnectionRequest = components['schemas']['JellyfinConnectionRequest']
export type JellyfinConnectionProblem = components['schemas']['JellyfinConnectionProblem']

/**
 * Sends a request to the backend. State-changing methods carry the CSRF token, fetching it
 * first if this browser has none yet. The whole call rejects if it takes longer than
 * API_TIMEOUT_MS.
 */
export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET'
  const signal = AbortSignal.timeout(API_TIMEOUT_MS)
  const headers = new Headers(init.headers)
  if (STATE_CHANGING_METHODS.has(method)) {
    headers.set(CSRF_HEADER_NAME, await csrfToken(signal))
  }
  return fetch(path, { ...init, method, headers, credentials: 'same-origin', signal })
}

/** Form login; answers 204 on success and 401 on bad credentials. */
export function login({ username, password }: Credentials): Promise<Response> {
  return apiFetch(LOGIN_PATH, { method: 'POST', body: new URLSearchParams({ username, password }) })
}

export function logout(): Promise<Response> {
  return apiFetch(LOGOUT_PATH, { method: 'POST' })
}

/** The signed-in admin; rejects when this browser has no session. */
export async function fetchSession(): Promise<Session> {
  const response = await apiFetch(AUTH_PATH)
  if (!response.ok) {
    throw new Error(`GET ${AUTH_PATH} returned ${response.status}`)
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the generated types and OpenApiSpecTest pin the shape.
  return (await response.json()) as Session
}

/** Whether the admin still has to be created; anyone may ask. */
export async function fetchSetupStatus(): Promise<SetupStatus> {
  const response = await apiFetch(SETUP_PATH)
  if (!response.ok) {
    throw new Error(`GET ${SETUP_PATH} returned ${response.status}`)
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the generated types and OpenApiSpecTest pin the shape.
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

/** The saved Jellyfin URL and whether an API key is saved. Never the key itself. */
export async function fetchJellyfinConnection(): Promise<JellyfinConnection> {
  const response = await apiFetch(JELLYFIN_CONNECTION_PATH)
  if (!response.ok) {
    throw new Error(`GET ${JELLYFIN_CONNECTION_PATH} returned ${response.status}`)
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the generated types and OpenApiSpecTest pin the shape.
  return (await response.json()) as JellyfinConnection
}

/** Replaces the saved connection; answers 204, or 400 as documented in openapi.json. */
export function saveJellyfinConnection(request: JellyfinConnectionRequest): Promise<Response> {
  return apiFetch(JELLYFIN_CONNECTION_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

// Read from the cookie on every request rather than cached: Spring rotates the token on login
// and logout, and the browser's cookie is always the current one.
async function csrfToken(signal: AbortSignal): Promise<string> {
  const existing = readCsrfCookie()
  if (existing) return existing

  const response = await fetch(CSRF_PATH, { credentials: 'same-origin', signal })
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
