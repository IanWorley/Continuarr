import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

const STEP_NUMBER_WIDTH = 2
const POSTGRES_IMAGE_PREFIX = 'postgres:'
// Testcontainers' PostgreSQLContainer defaults.
const POSTGRES_USER = 'test'
const POSTGRES_DATABASE = 'test'

/**
 * @param {string} name
 * @returns {string}
 */
function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; run journeys through control.sh drive`)
  return value
}

export const FRONTEND_URL = requiredEnv('CONTINUARR_FRONTEND_URL')
export const BACKEND_URL = requiredEnv('CONTINUARR_BACKEND_URL')
export const RUN_DIR = requiredEnv('CONTINUARR_VERIFY_RUN_DIR')
export const EVIDENCE_DIR = requiredEnv('CONTINUARR_VERIFY_EVIDENCE')

/** @type {typeof import('playwright-core')} */
const playwright = createRequire(join(requiredEnv('CONTINUARR_VERIFY_TOOLS'), 'package.json'))('playwright-core')

const run = promisify(execFile)

/**
 * Runs SQL in this launch's Postgres, for states a fresh database can't reach through the app.
 * @param {string} sql
 * @returns {Promise<void>}
 */
export async function runSql(sql) {
  const ids = (await readFile(join(RUN_DIR, 'containers'), 'utf8')).split('\n').filter(Boolean)
  const images = await Promise.all(ids.map(async (id) => (await run('docker', ['inspect', '--format', '{{.Config.Image}}', id])).stdout.trim()))
  const postgres = ids.find((_, index) => images[index].startsWith(POSTGRES_IMAGE_PREFIX))
  assert.ok(postgres, 'this run recorded its Postgres container')
  await run('docker', ['exec', postgres, 'psql', '-U', POSTGRES_USER, '-d', POSTGRES_DATABASE, '-c', sql])
}

/**
 * @typedef {object} Journey
 * @property {import('playwright-core').Page} page
 * @property {(name: string) => Promise<void>} step Saves an ARIA snapshot and a screenshot of the current page.
 * @property {(name: string, value: unknown) => Promise<void>} record Saves a JSON side-effect observation.
 */

/**
 * @param {(journey: Journey) => Promise<void>} body
 * @returns {Promise<void>}
 */
export async function runJourney(body) {
  await mkdir(EVIDENCE_DIR, { recursive: true })
  const browser = await playwright.chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  let stepCount = 0

  /** @param {string} name */
  async function step(name) {
    stepCount += 1
    const base = join(EVIDENCE_DIR, `${String(stepCount).padStart(STEP_NUMBER_WIDTH, '0')}-${name}`)
    const aria = await page.locator('body').ariaSnapshot()
    await writeFile(`${base}.aria.yaml`, `# ${page.url()}\n${aria}\n`)
    await page.screenshot({ path: `${base}.png`, fullPage: true })
    console.log(`ok    ${name} at ${page.url()}`)
  }

  /**
   * @param {string} name
   * @param {unknown} value
   */
  async function record(name, value) {
    await writeFile(join(EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
    console.log(`ok    ${name}: ${JSON.stringify(value)}`)
  }

  try {
    await body({ page, step, record })
    console.log(`Evidence in ${EVIDENCE_DIR}`)
  } catch (error) {
    await step('failed').catch(() => undefined)
    throw error
  } finally {
    await browser.close()
  }
}
