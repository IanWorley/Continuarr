import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const HOME_PATH = '/settings/media-servers'
const CONNECTION_PATH = '/api/v1/jellyfin/connection'
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const DESKTOP_CONTROL_HEIGHT = 36
const TOUCH_TARGET = 44
const LABEL_COLUMN_WIDTH = 128
const LABEL_GAP = 12
const HTTP_INTERNAL_SERVER_ERROR = 500
const JELLYFIN_URL = 'http://jellyfin.verify.local:8096'
const NEW_URL = 'https://jf.verify.example'
const API_KEY_BYTES = 16

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)
const backendLog = join((await readFile(join(RUN_DIR, 'evidence-dir'), 'utf8')).trim(), 'backend.log')

// Made fresh for each run and never written to the evidence, so a leak can only come from the app.
const apiKey = randomBytes(API_KEY_BYTES).toString('hex')

await runJourney(async ({ page, step, record }) => {
  const card = page.getByRole('region', { name: 'Jellyfin' })
  const urlField = card.getByLabel('Server URL')
  const keyField = card.getByLabel('API key')
  const save = card.getByRole('button', { name: 'Save' })
  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? null)
  const box = async (/** @type {import('playwright-core').Locator} */ locator) => {
    const found = await locator.boundingBox()
    assert.ok(found, 'the element is on screen')
    return found
  }
  const settle = () => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
  const readConnection = async () => {
    const response = await page.request.get(`${FRONTEND_URL}${CONNECTION_PATH}`)
    const text = await response.text()
    assert.ok(!text.includes(apiKey), 'GET never returns the API key')
    return JSON.parse(text)
  }

  await page.setViewportSize(DESKTOP)
  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)
  await card.getByText('No key saved yet').waitFor()
  await card.getByText('Nothing saved yet.').waitFor()
  await card.getByText('Not configured').waitFor()

  const desktop = {
    urlHeight: (await box(urlField)).height,
    saveHeight: (await box(save)).height,
    labelWidth: (await box(card.getByText('Server URL', { exact: true }))).width,
  }
  assert.equal(desktop.urlHeight, DESKTOP_CONTROL_HEIGHT, 'desktop fields are 36px')
  assert.equal(desktop.saveHeight, DESKTOP_CONTROL_HEIGHT, 'desktop buttons are 36px')
  const label = await box(card.getByText('Server URL', { exact: true }))
  const field = await box(urlField)
  assert.equal(Math.round(field.x - (label.x + label.width)), LABEL_GAP, 'the label sits in a column left of the field')
  assert.equal(Math.round(label.width), LABEL_COLUMN_WIDTH, 'the label column is 128px')
  await step('desktop-first-run')

  await urlField.focus()
  await page.keyboard.type(JELLYFIN_URL)
  await page.keyboard.press('Enter')
  await card.getByText('Paste the API key. Continuarr needs it on every save.', { exact: false }).waitFor()
  assert.equal(await focusedId(), await keyField.getAttribute('id'), 'a failed save focuses the first bad field')
  await card.getByText('Fix 1 field, then save again. Your entries are kept.').waitFor()
  await step('desktop-key-required-keyboard')

  await urlField.fill('jellyfin.home.lan:8096')
  await keyField.fill('has a space')
  await keyField.press('Enter')
  await card.getByText('Start the address with http:// or https://.').waitFor()
  await card.getByText('Jellyfin keys never contain spaces', { exact: false }).waitFor()
  await card.getByText('Fix 2 fields, then save again. Your entries are kept.').waitFor()
  assert.equal(await focusedId(), await urlField.getAttribute('id'), 'focus goes to the first of two bad fields')
  await step('desktop-two-fields-wrong')

  await urlField.fill(JELLYFIN_URL)
  await keyField.fill(apiKey)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await card.getByText('Saved. Continuarr uses this from now on.').waitFor()
  assert.equal(await keyField.inputValue(), '', 'the key field clears after a save')
  await card.getByText('Configured', { exact: true }).waitFor()
  await settle()
  await step('desktop-saved-keyboard')
  const afterSave = await readConnection()
  assert.deepEqual(afterSave, { url: JELLYFIN_URL, apiKeyState: 'STORED' }, 'the save reached the server')

  await page.reload()
  await card.getByText('A key is saved').waitFor()
  assert.equal(await urlField.inputValue(), JELLYFIN_URL, 'a reload shows the saved URL')
  assert.equal(await keyField.inputValue(), '', 'a reload never shows the saved key')
  await step('desktop-stored-after-reload')

  await save.click()
  await card.getByText('No changes to save.').waitFor()
  await urlField.fill(NEW_URL)
  await card.getByText(`Saved: ${JELLYFIN_URL}`).waitFor()
  await card.getByText('Unsaved changes').waitFor()
  await step('desktop-unsaved-changes')

  await page.route(`**${CONNECTION_PATH}`, (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: HTTP_INTERNAL_SERVER_ERROR }) : route.continue(),
  )
  await keyField.fill(apiKey)
  await save.click()
  await card.getByText("Couldn't save your settings.").waitFor()
  await card.getByText('Last save failed. The saved settings still apply.').waitFor()
  assert.equal(await urlField.inputValue(), NEW_URL, 'a failed save keeps the entries')
  await step('desktop-save-failed-stubbed-500')
  await page.unroute(`**${CONNECTION_PATH}`)

  await page.route(`**${CONNECTION_PATH}`, (route) => route.fulfill({ status: HTTP_INTERNAL_SERVER_ERROR }))
  await page.reload()
  await card.getByText("Couldn't load settings.").waitFor()
  await card.getByText('Unknown', { exact: true }).waitFor()
  await step('desktop-load-failed-stubbed-500')
  await page.unroute(`**${CONNECTION_PATH}`)
  await card.getByRole('button', { name: 'Retry' }).click()
  await card.getByText('A key is saved').waitFor()
  assert.equal(await urlField.inputValue(), JELLYFIN_URL, 'Retry loads what is saved, not the failed edit')

  await page.setViewportSize(PHONE)
  await page.reload()
  await card.getByText('A key is saved').waitFor()
  const phoneLabel = await box(card.getByText('Server URL', { exact: true }))
  const phoneField = await box(urlField)
  const phoneSave = await box(save)
  const phone = { urlHeight: phoneField.height, saveHeight: phoneSave.height, saveWidth: phoneSave.width }
  assert.equal(phone.urlHeight, TOUCH_TARGET, 'phone fields are 44px')
  assert.equal(phone.saveHeight, TOUCH_TARGET, 'phone buttons are 44px')
  assert.ok(phoneLabel.y + phoneLabel.height <= phoneField.y, 'phone labels sit above their fields')
  assert.equal(Math.round(phoneLabel.x), Math.round(phoneField.x), 'phone labels line up with their fields')
  assert.equal(Math.round(phoneSave.width), Math.round(phoneField.width), 'Save fills the footer row on phones')
  await step('phone-stored')

  await urlField.fill('http://jelly_fin.local:8096')
  await save.click()
  await card.getByText("Server names can't contain _.", { exact: false }).waitFor()
  await step('phone-url-wrong')

  const log = await readFile(backendLog, 'utf8')
  assert.ok(!log.includes(apiKey), 'the backend log never holds the API key')
  await record('jellyfin-card', { desktop, phone, afterSave, apiKeyInResponsesOrBackendLog: false })
})
