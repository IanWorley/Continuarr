import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKEND_URL, FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const ADMIN_USERNAME = 'admin'
const PASSWORD_BYTES = 16
const OWNER_ONLY_FILE_MODE = 0o600

const setupToken = process.env.CONTINUARR_SETUP_TOKEN
if (!setupToken) throw new Error('No setup token in this run; an admin already exists, so relaunch for a fresh database')
const password = randomBytes(PASSWORD_BYTES).toString('hex')

await runJourney(async ({ page, step, record }) => {
  const token = page.getByLabel('Setup token')
  const username = page.getByLabel('Username')
  const passwordField = page.getByLabel('Password', { exact: true })
  const confirm = page.getByLabel('Confirm password')
  const createAdmin = page.getByRole('button', { name: 'Create admin' })

  await page.goto(`${FRONTEND_URL}/`)
  await page.waitForURL('**/setup')
  await page.getByRole('heading', { name: 'Set up Continuarr' }).waitFor()
  await step('redirected-to-setup')

  await token.fill('not-the-setup-token')
  await username.fill(ADMIN_USERNAME)
  await passwordField.fill(password)
  await confirm.fill(password)
  await createAdmin.click()
  await page.getByText("That setup token doesn't match.").waitFor()
  assert.match(page.url(), /\/setup$/, 'a wrong token keeps the visitor on /setup')
  await step('wrong-token-rejected')

  await token.fill(setupToken)
  await confirm.fill(`${password}-typo`)
  await createAdmin.click()
  await page.getByText("The passwords don't match.").waitFor()
  await step('password-mismatch-caught')

  await confirm.fill(password)
  await createAdmin.click()
  await page.waitForURL('**/login')
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  await step('admin-created')

  const status = await (await page.request.get(`${BACKEND_URL}/api/setup`)).json()
  assert.deepEqual(status, { required: false }, 'the backend reports setup as done')
  await record('setup-status-after', status)

  await page.goto(`${FRONTEND_URL}/setup`)
  await page.waitForURL('**/login')
  await step('setup-page-closed')
})

await writeFile(join(RUN_DIR, 'admin-credentials.json'), JSON.stringify({ username: ADMIN_USERNAME, password }), {
  mode: OWNER_ONLY_FILE_MODE,
})
