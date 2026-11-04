import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKEND_URL, FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const SESSION_PROBE_PATH = '/v3/api-docs'

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)

await runJourney(async ({ page, step, record }) => {
  const username = page.getByLabel('Username')
  const password = page.getByLabel('Password')
  const signIn = page.getByRole('button', { name: 'Sign in' })
  const sessionProbeStatus = async () => (await page.request.get(`${BACKEND_URL}${SESSION_PROBE_PATH}`)).status()

  const before = await sessionProbeStatus()
  assert.equal(before, HTTP_UNAUTHORIZED, 'a new browser is signed out')

  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  await step('login-page')

  await username.fill(admin.username)
  await password.fill(`${admin.password}-wrong`)
  await signIn.click()
  await page.getByText('Wrong username or password').waitFor()
  assert.match(page.url(), /\/login$/, 'a rejected login stays on /login')
  await step('bad-credentials-rejected')

  await password.fill(admin.password)
  await signIn.click()
  await page.waitForURL(`${FRONTEND_URL}/`)
  await page.getByText('Continuarr', { exact: true }).waitFor()
  await step('signed-in')

  const after = await sessionProbeStatus()
  assert.equal(after, HTTP_OK, 'the session cookie now authenticates API calls')
  await record('session-probe', { path: SESSION_PROBE_PATH, before, after })
})
