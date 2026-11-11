import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const CONNECTION_PATH = '/api/v1/jellyfin/connection'
const CSRF_PATH = '/api/csrf'
const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'
const HOME_PATH = '/settings/media-servers'
const JELLYFIN_URL = 'http://jellyfin.verify.local:8096'
const INVALID_URL = 'ftp://jellyfin.verify.local'
const API_KEY_BYTES = 16
const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_BAD_REQUEST = 400

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

  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)
  await step('signed-in')

  const before = await read()
  assert.deepEqual(before, { url: null, apiKeyState: 'NONE' }, 'nothing is saved on a fresh launch')

  const rejected = await save(INVALID_URL, invalidApiKey)
  assert.equal(rejected.status, HTTP_BAD_REQUEST)
  assert.deepEqual(rejected.body, { invalidFields: ['URL', 'API_KEY'] })
  assert.deepEqual(await read(), before, 'a rejected save stores nothing')

  const saved = await save(JELLYFIN_URL, apiKey)
  assert.equal(saved.status, HTTP_NO_CONTENT)

  const after = await read()
  assert.deepEqual(after, { url: JELLYFIN_URL, apiKeyState: 'STORED' }, 'GET reports the saved URL and a stored key')

  const log = await readFile(backendLog, 'utf8')
  assert.ok(!log.includes(apiKey), 'the backend log never holds the API key')

  await record('jellyfin-connection', {
    before,
    rejected,
    savedStatus: saved.status,
    after,
    apiKeyInResponsesOrBackendLog: false,
  })
})
