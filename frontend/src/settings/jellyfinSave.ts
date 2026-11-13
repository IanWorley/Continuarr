import type { JellyfinConnection, JellyfinConnectionPatch } from '../api/client.ts'
import { API_KEY_MESSAGES, checkApiKey, checkUrl, serverHost } from './jellyfinChecks.ts'

export type Field = 'url' | 'apiKey'
export type Draft = Record<Field, string>
export type FieldErrors = Partial<Record<Field, string>>

export const KEY_FOR_HTTP = 'Paste the key to move to http. The saved key never travels unencrypted.'

const HTTPS_URL = /^https:/i
const HTTP_URL = /^http:/i

/** What pressing Save should do with the form as it stands. */
export type SavePlan =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; errors: FieldErrors }
  /** The saved key would go to a different server, so the admin confirms first. */
  | { kind: 'confirm-host'; host: string; patch: JellyfinConnectionPatch }
  | { kind: 'send'; patch: JellyfinConnectionPatch }

/**
 * Sends only what changed. An empty key field keeps the saved key, so the key is needed only on a first save,
 * when the saved one can't be read, or when the URL moves from https to http. Mirrors the server's PATCH rules.
 */
export function planSave(saved: JellyfinConnection, draft: Draft): SavePlan {
  const url = draft.url.trim()
  const apiKey = draft.apiKey.trim()
  const urlChanged = url !== (saved.url ?? '')
  if (!urlChanged && !apiKey) return { kind: 'unchanged' }

  const errors: FieldErrors = {}
  const urlError = checkUrl(url)
  if (urlError) errors.url = urlError
  const keyError = apiKey ? checkApiKey(apiKey) : missingKeyError(saved, url)
  if (keyError) errors.apiKey = keyError
  if (Object.keys(errors).length > 0) return { kind: 'invalid', errors }

  const patch: JellyfinConnectionPatch = { ...(urlChanged ? { url } : {}), ...(apiKey ? { apiKey } : {}) }
  const host = serverHost(url)
  if (!apiKey && urlChanged && host !== serverHost(saved.url ?? '')) return { kind: 'confirm-host', host, patch }
  return { kind: 'send', patch }
}

/** Why an empty key field can't keep the saved key, or null when it can. */
function missingKeyError(saved: JellyfinConnection, url: string): string | null {
  if (saved.apiKeyState !== 'STORED') return API_KEY_MESSAGES.empty
  if (HTTPS_URL.test(saved.url ?? '') && HTTP_URL.test(url)) return KEY_FOR_HTTP
  return null
}
