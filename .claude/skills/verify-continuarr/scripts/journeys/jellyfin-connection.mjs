import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKEND_URL, FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const HTTP_BAD_REQUEST = 400
const CONNECTION_PATH = '/api/v1/jellyfin/connection'
const INVALID_URL = 'ftp://jellyfin.local'
const SAVED_URL = 'http://jellyfin.local:8096'
const SAVED_API_KEY = 'dummy-key-0123'

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)

await runJourney(async ({ page, step, record }) => {
  const savedConnection = page.getByRole('region', { name: 'Saved connection' })
  const url = page.getByLabel('Server URL')
  const apiKey = page.getByLabel('API key')
  const save = page.getByRole('button', { name: 'Save connection' })

  /** @returns {Promise<unknown>} */
  const readBack = async () => (await page.request.get(`${BACKEND_URL}${CONNECTION_PATH}`)).json()

  /**
   * @param {import('playwright-core').Locator} field
   * @returns {Promise<string>}
   */
  const describedText = async (field) => {
    const id = await field.getAttribute('aria-describedby')
    assert.ok(id, 'an invalid field names its message')
    return (await page.locator(`[id="${id}"]`).textContent()) ?? ''
  }

  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Sign out' }).waitFor()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click()
  await page.waitForURL(`${FRONTEND_URL}/settings`)
  await savedConnection.getByText('Nothing saved yet.').waitFor()
  assert.equal(await url.inputValue(), '', 'nothing saved leaves the URL empty')
  await step('nothing-saved')

  await url.fill(INVALID_URL)
  await apiKey.fill(SAVED_API_KEY)
  const rejected = page.waitForResponse((response) => response.url().endsWith(CONNECTION_PATH) && response.request().method() === 'PUT')
  await save.click()
  const rejection = await rejected
  assert.equal(rejection.status(), HTTP_BAD_REQUEST, 'the server rejects the URL')
  const rejectionBody = await rejection.json()
  assert.deepEqual(rejectionBody, { invalidFields: ['URL'] }, 'the server names only the URL')
  await record('rejected-save', { status: rejection.status(), body: rejectionBody })
  await page.getByText(/Enter an http:\/\/ or https:\/\/ address/).waitFor()
  assert.equal(await url.getAttribute('aria-invalid'), 'true', 'the URL field is marked invalid')
  assert.equal(await apiKey.getAttribute('aria-invalid'), 'false', 'the valid key is not marked invalid')
  assert.match(await describedText(url), /http:\/\/ or https:\/\//)
  await step('invalid-url-rejected')

  await url.fill(SAVED_URL)
  await apiKey.fill(SAVED_API_KEY)
  await save.click()
  await page.getByText('Connection saved.').waitFor()
  await savedConnection.getByText(SAVED_URL).waitFor()
  await savedConnection.getByText('Stored').waitFor()
  assert.equal(await apiKey.inputValue(), '', 'the key field clears after a save')
  await step('saved')

  const connection = await readBack()
  assert.deepEqual(connection, { url: SAVED_URL }, 'the read-back has the URL and no key')
  await record('connection-read-back', { path: CONNECTION_PATH, connection })

  await page.reload()
  await savedConnection.getByText(SAVED_URL).waitFor()
  assert.equal(await url.inputValue(), SAVED_URL, 'the URL field starts from the saved URL')
  assert.equal(await apiKey.inputValue(), '', 'the key field always starts empty')
  await step('after-reload')
})
