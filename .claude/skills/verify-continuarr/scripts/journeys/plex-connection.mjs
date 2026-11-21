import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKEND_URL, FRONTEND_URL, RUN_DIR, runJourney, runSql } from '../journey.mjs'

const CONNECTION_PATH = '/api/v1/plex/connection'
const HOME_PATH = '/settings/media-servers'
const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const CLEAR_TOKEN_SQL = 'UPDATE plex_connection SET token = NULL'
const NOTHING_SAVED = { url: null, source: null, tokenState: 'NONE' }

// The launch read these from the same shell, so the journey knows what it seeded and which token must never leak.
const plexUrl = process.env.CONTINUARR_PLEX_URL ?? ''
const plexToken = process.env.CONTINUARR_PLEX_TOKEN ?? ''

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)
const backendLog = join((await readFile(join(RUN_DIR, 'evidence-dir'), 'utf8')).trim(), 'backend.log')

/** @param {string} text */
function assertNoToken(text) {
  assert.ok(!plexToken || !text.includes(plexToken), 'nothing returns or logs the Plex token')
}

await runJourney(async ({ page, step, record }) => {
  const read = async () => {
    const response = await page.request.get(`${FRONTEND_URL}${CONNECTION_PATH}`)
    const text = await response.text()
    assertNoToken(text)
    return { status: response.status(), body: JSON.parse(text) }
  }

  const anonymous = await fetch(`${BACKEND_URL}${CONNECTION_PATH}`)
  const withoutSession = { status: anonymous.status, body: await anonymous.text() }
  assert.equal(withoutSession.status, HTTP_UNAUTHORIZED, 'GET without a session answers 401')
  assertNoToken(withoutSession.body)

  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)
  await step('signed-in')

  const startup = await read()
  assert.equal(startup.status, HTTP_OK)
  let tokenCleared = null
  if (!plexToken) {
    assert.deepEqual(startup.body, NOTHING_SAVED, 'a launch without CONTINUARR_PLEX_* saves nothing')
  } else {
    assert.deepEqual(startup.body, { url: plexUrl, source: 'ENVIRONMENT', tokenState: 'STORED' }, 'the launch seeded the Plex connection')
    await runSql(CLEAR_TOKEN_SQL)
    tokenCleared = await read()
    assert.deepEqual(tokenCleared.body, { url: plexUrl, source: 'ENVIRONMENT', tokenState: 'NONE' }, 'GET keeps the URL and source and reports no token once the token is gone')
  }

  assertNoToken(await readFile(backendLog, 'utf8'))

  await record('plex-connection', {
    seeded: Boolean(plexToken),
    withoutSession,
    startup,
    tokenCleared,
    tokenInResponsesOrBackendLog: false,
  })
})
