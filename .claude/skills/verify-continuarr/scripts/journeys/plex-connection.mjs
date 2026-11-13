import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BACKEND_URL, FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const CONNECTION_PATH = '/api/v1/plex/connection'
const HOME_PATH = '/settings/media-servers'
const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const POSTGRES_IMAGE_PREFIX = 'postgres:'
// Testcontainers' PostgreSQLContainer defaults.
const POSTGRES_USER = 'test'
const POSTGRES_DATABASE = 'test'
const CORRUPT_CIPHERTEXT_SQL = "UPDATE plex_connection SET token_ciphertext = 'not AES-GCM ciphertext'::bytea"
const NO_ENCRYPTION_KEY_WARNING = "CONTINUARR_PLEX_TOKEN is set but CONTINUARR_ENCRYPTION_KEY isn't, so the Plex connection wasn't saved"
const NOTHING_SAVED = { url: null, source: null, tokenState: 'NONE' }

// The launch read these from the same shell, so the journey knows what it seeded and which token must never leak.
const plexUrl = process.env.CONTINUARR_PLEX_URL ?? ''
const plexToken = process.env.CONTINUARR_PLEX_TOKEN ?? ''
const launchedWithoutEncryptionKey = process.env.CONTINUARR_VERIFY_ENCRYPTION_KEY === ''

const run = promisify(execFile)

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)
const backendLog = join((await readFile(join(RUN_DIR, 'evidence-dir'), 'utf8')).trim(), 'backend.log')

async function makeSavedTokenUnreadable() {
  const ids = (await readFile(join(RUN_DIR, 'containers'), 'utf8')).split('\n').filter(Boolean)
  const images = await Promise.all(ids.map(async (id) => (await run('docker', ['inspect', '--format', '{{.Config.Image}}', id])).stdout.trim()))
  const postgres = ids.find((_, index) => images[index].startsWith(POSTGRES_IMAGE_PREFIX))
  assert.ok(postgres, 'this run recorded its Postgres container')
  await run('docker', ['exec', postgres, 'psql', '-U', POSTGRES_USER, '-d', POSTGRES_DATABASE, '-c', CORRUPT_CIPHERTEXT_SQL])
}

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
  let unreadable = null
  if (!plexToken) {
    assert.deepEqual(startup.body, NOTHING_SAVED, 'a launch without CONTINUARR_PLEX_* saves nothing')
  } else if (launchedWithoutEncryptionKey) {
    assert.deepEqual(startup.body, NOTHING_SAVED, 'a seed without an encryption key saves nothing')
    assert.ok((await readFile(backendLog, 'utf8')).includes(NO_ENCRYPTION_KEY_WARNING), 'the backend log says why nothing was saved')
  } else {
    assert.deepEqual(startup.body, { url: plexUrl, source: 'ENVIRONMENT', tokenState: 'STORED' }, 'the launch seeded the Plex connection')
    await makeSavedTokenUnreadable()
    unreadable = await read()
    assert.deepEqual(unreadable.body, { url: plexUrl, source: 'ENVIRONMENT', tokenState: 'UNREADABLE' }, 'GET reports a token that no longer decrypts')
  }

  assertNoToken(await readFile(backendLog, 'utf8'))

  await record('plex-connection', {
    seeded: Boolean(plexToken),
    launchedWithoutEncryptionKey,
    withoutSession,
    startup,
    unreadable,
    tokenInResponsesOrBackendLog: false,
  })
})
