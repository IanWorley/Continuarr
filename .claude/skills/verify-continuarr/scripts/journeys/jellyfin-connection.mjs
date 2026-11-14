import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BACKEND_URL, FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const CONNECTION_PATH = '/api/v1/jellyfin/connection'
const MATCH_PATH = `${CONNECTION_PATH}/api-key/match`
const CSRF_PATH = '/api/csrf'
const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'
const HOME_PATH = '/settings/media-servers'
const JELLYFIN_URL = 'http://jellyfin.verify.local:8096'
const INVALID_URL = 'ftp://jellyfin.verify.local'
const HTTPS_URL = 'https://jellyfin.verify.example:8920'
const HTTP_URL = 'http://jellyfin.verify.example:8096'
const API_KEY_BYTES = 16
const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const POSTGRES_IMAGE_PREFIX = 'postgres:'
// Testcontainers' PostgreSQLContainer defaults.
const POSTGRES_USER = 'test'
const POSTGRES_DATABASE = 'test'
const CLEAR_KEY_SQL = 'UPDATE jellyfin_connection SET api_key = NULL'

const run = promisify(execFile)

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)
const backendLog = join((await readFile(join(RUN_DIR, 'evidence-dir'), 'utf8')).trim(), 'backend.log')

// Made fresh for each run and never written to the evidence, so a leak can only come from the app.
const apiKey = randomBytes(API_KEY_BYTES).toString('hex')
const invalidApiKey = `${apiKey} with spaces`
const otherApiKey = randomBytes(API_KEY_BYTES).toString('hex')
// Jackson quotes the bad token in its parse error, so an unquoted key is the one most likely to leak.
const unreadableBody = `{"apiKey": ${otherApiKey}}`

async function clearSavedKey() {
  const ids = (await readFile(join(RUN_DIR, 'containers'), 'utf8')).split('\n').filter(Boolean)
  const images = await Promise.all(ids.map(async (id) => (await run('docker', ['inspect', '--format', '{{.Config.Image}}', id])).stdout.trim()))
  const postgres = ids.find((_, index) => images[index].startsWith(POSTGRES_IMAGE_PREFIX))
  assert.ok(postgres, 'this run recorded its Postgres container')
  await run('docker', ['exec', postgres, 'psql', '-U', POSTGRES_USER, '-d', POSTGRES_DATABASE, '-c', CLEAR_KEY_SQL])
}

async function matchWithoutSession() {
  const csrf = await fetch(`${BACKEND_URL}${CSRF_PATH}`)
  const cookie = csrf.headers.getSetCookie().map((header) => header.split(';')[0]).find((pair) => pair.startsWith(`${CSRF_COOKIE}=`))
  assert.ok(cookie, 'the backend set the CSRF cookie without a session')
  const response = await fetch(`${BACKEND_URL}${MATCH_PATH}`, {
    method: 'POST',
    headers: { Cookie: cookie, [CSRF_HEADER]: decodeURIComponent(cookie.slice(CSRF_COOKIE.length + 1)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  return { status: response.status, body: await response.text() }
}

await runJourney(async ({ page, step, record }) => {
  const api = page.request
  const csrfToken = async () => {
    await api.get(`${FRONTEND_URL}${CSRF_PATH}`)
    const cookie = (await page.context().cookies()).find(({ name }) => name === CSRF_COOKIE)
    assert.ok(cookie, 'the backend set the CSRF cookie')
    return decodeURIComponent(cookie.value)
  }
  const read = async () => {
    const response = await api.get(`${FRONTEND_URL}${CONNECTION_PATH}`)
    assert.equal(response.status(), HTTP_OK)
    const text = await response.text()
    assert.ok(!text.includes(apiKey), 'GET never returns the API key')
    return JSON.parse(text)
  }
  /** @param {string} url @param {string} key */
  const save = async (url, key) => {
    const response = await api.put(`${FRONTEND_URL}${CONNECTION_PATH}`, {
      headers: { [CSRF_HEADER]: await csrfToken() },
      data: { url, apiKey: key },
    })
    const text = await response.text()
    assert.ok(!text.includes(apiKey), 'PUT never echoes the API key')
    return { status: response.status(), body: text ? JSON.parse(text) : null }
  }
  /** @param {Record<string, string>} data */
  const patch = async (data) => {
    const response = await api.patch(`${FRONTEND_URL}${CONNECTION_PATH}`, {
      headers: { [CSRF_HEADER]: await csrfToken() },
      data,
    })
    const text = await response.text()
    assert.ok(!text.includes(apiKey), 'PATCH never echoes the API key')
    return { status: response.status(), body: text ? JSON.parse(text) : null }
  }
  /** @param {{ data?: unknown, body?: string, csrf?: boolean }} request */
  const match = async ({ data, body, csrf = true }) => {
    const response = await api.post(`${FRONTEND_URL}${MATCH_PATH}`, {
      headers: { 'Content-Type': 'application/json', ...(csrf ? { [CSRF_HEADER]: await csrfToken() } : {}) },
      ...(body === undefined ? { data } : { data: body }),
    })
    const text = await response.text()
    assert.ok(!text.includes(apiKey) && !text.includes(otherApiKey), 'matching never returns either key')
    return { status: response.status(), body: text ? JSON.parse(text) : null }
  }

  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)
  await step('signed-in')

  const before = await read()
  assert.deepEqual(before, { url: null, apiKeyState: 'NONE' }, 'nothing is saved on a fresh launch')

  const matchBeforeSave = await match({ data: { apiKey } })
  assert.deepEqual(matchBeforeSave, { status: HTTP_OK, body: { result: 'NONE' } }, 'matching with nothing saved answers NONE')

  const rejected = await save(INVALID_URL, invalidApiKey)
  assert.equal(rejected.status, HTTP_BAD_REQUEST)
  assert.deepEqual(rejected.body, { invalidFields: ['URL', 'API_KEY'] })
  assert.deepEqual(await read(), before, 'a rejected save stores nothing')

  const saved = await save(JELLYFIN_URL, apiKey)
  assert.equal(saved.status, HTTP_NO_CONTENT)

  const after = await read()
  assert.deepEqual(after, { url: JELLYFIN_URL, apiKeyState: 'STORED' }, 'GET reports the saved URL and a stored key')

  const matched = await match({ data: { apiKey } })
  assert.deepEqual(matched, { status: HTTP_OK, body: { result: 'MATCH' } }, 'the saved key answers MATCH')
  const mismatched = await match({ data: { apiKey: otherApiKey } })
  assert.deepEqual(mismatched, { status: HTTP_OK, body: { result: 'MISMATCH' } }, 'another key answers MISMATCH')
  const invalidKey = await match({ data: { apiKey: invalidApiKey } })
  assert.deepEqual(invalidKey, { status: HTTP_BAD_REQUEST, body: null }, 'an invalid key answers 400 with no body')
  const unparsed = await match({ body: unreadableBody })
  assert.deepEqual(unparsed, { status: HTTP_BAD_REQUEST, body: null }, 'a body that does not parse answers 400 with no body')
  const withoutCsrf = await match({ data: { apiKey }, csrf: false })
  assert.equal(withoutCsrf.status, HTTP_FORBIDDEN, 'matching without the CSRF header answers 403')
  const withoutSession = await matchWithoutSession()
  assert.equal(withoutSession.status, HTTP_UNAUTHORIZED, 'matching without a session answers 401')
  assert.ok(!withoutSession.body.includes(apiKey), 'a refused match never echoes the key')

  const moved = await patch({ url: HTTPS_URL })
  assert.equal(moved.status, HTTP_NO_CONTENT)
  const afterMove = await read()
  assert.deepEqual(afterMove, { url: HTTPS_URL, apiKeyState: 'STORED' }, 'a new URL alone saves')
  const keptAfterMove = await match({ data: { apiKey } })
  assert.deepEqual(keptAfterMove.body, { result: 'MATCH' }, 'the saved key is unchanged after a URL change')

  const downgrade = await patch({ url: HTTP_URL })
  assert.deepEqual(downgrade, { status: HTTP_BAD_REQUEST, body: { invalidFields: ['API_KEY'] } }, 'https to http needs a new key')
  const downgradeWithKey = await patch({ url: JELLYFIN_URL, apiKey })
  assert.equal(downgradeWithKey.status, HTTP_NO_CONTENT, 'https to http saves once the key is sent')

  await clearSavedKey()
  const keyCleared = await read()
  assert.deepEqual(keyCleared, { url: JELLYFIN_URL, apiKeyState: 'NONE' }, 'GET keeps the URL and reports no key once the key is gone')
  const matchKeyCleared = await match({ data: { apiKey } })
  assert.deepEqual(matchKeyCleared, { status: HTTP_OK, body: { result: 'NONE' } }, 'matching with the key gone answers NONE')
  const urlOnlyKeyCleared = await patch({ url: HTTPS_URL })
  assert.deepEqual(urlOnlyKeyCleared, { status: HTTP_BAD_REQUEST, body: { invalidFields: ['API_KEY'] } }, 'a new URL alone needs a key once the key is gone')

  const log = await readFile(backendLog, 'utf8')
  assert.ok(!log.includes(apiKey), 'the backend log never holds the API key')
  assert.ok(!log.includes(otherApiKey), 'the backend log never holds a submitted key')

  await record('jellyfin-connection', {
    before,
    rejected,
    savedStatus: saved.status,
    after,
    keyCleared,
    apiKeyInResponsesOrBackendLog: false,
  })
  await record('jellyfin-connection-patch', {
    moved: moved.status,
    afterMove,
    keptAfterMove: keptAfterMove.body,
    downgrade,
    downgradeWithKey: downgradeWithKey.status,
    urlOnlyKeyCleared,
  })
  await record('jellyfin-api-key-match', {
    noKeySaved: matchBeforeSave,
    match: matched,
    mismatch: mismatched,
    invalidKey,
    unreadableBody: unparsed,
    withoutCsrf,
    withoutSession,
    keyCleared: matchKeyCleared,
    eitherKeyInResponsesOrBackendLog: false,
  })
})
