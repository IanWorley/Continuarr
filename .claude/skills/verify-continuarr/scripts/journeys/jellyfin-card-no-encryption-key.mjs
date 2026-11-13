import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const HOME_PATH = '/settings/media-servers'
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const JELLYFIN_URL = 'http://jellyfin.verify.local:8096'
// A placeholder, never a real key. The server refuses to store anything without an encryption key.
const PLACEHOLDER_API_KEY = 'verify-placeholder-key'

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)

await runJourney(async ({ page, step, record }) => {
  const card = page.getByRole('region', { name: 'Jellyfin' })
  const save = card.getByRole('button', { name: 'Save' })

  await page.setViewportSize(DESKTOP)
  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)

  await card.getByLabel('Server URL').fill(JELLYFIN_URL)
  await card.getByLabel('API key').fill(PLACEHOLDER_API_KEY)
  await card.getByLabel('API key').press('Enter')
  await card.getByText("Continuarr can't store the API key yet.").waitFor()
  await card.getByText('Save is off until the server can encrypt the key.').waitFor()
  await card.getByText('No key saved yet').waitFor()
  assert.equal(await save.getAttribute('aria-disabled'), 'true', 'Save is off after a 503')
  await step('desktop-503')

  await page.setViewportSize(PHONE)
  await step('phone-503')

  await card.getByRole('button', { name: 'Reload settings' }).click()
  await card.getByText('Nothing saved yet.').waitFor()
  assert.equal(await save.getAttribute('aria-disabled'), 'false', 'Reload settings turns Save back on')
  assert.equal(await card.getByLabel('Server URL').inputValue(), JELLYFIN_URL, 'reloading keeps the entries')
  await step('phone-after-reload-settings')

  const read = await page.request.get(`${FRONTEND_URL}/api/v1/jellyfin/connection`)
  const connection = await read.json()
  assert.deepEqual(connection, { url: null, apiKeyState: 'NONE' }, 'a 503 stores nothing')
  await record('jellyfin-card-no-encryption-key', { connection })
})
