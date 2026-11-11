import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const HOME_PATH = '/settings/media-servers'
const DESKTOP = { width: 1440, height: 900 }
const NARROW_DESKTOP = { width: 1100, height: 900 }
const PHONE = { width: 390, height: 844 }
const DESKTOP_CONTROL_HEIGHT = 36
const TOUCH_TARGET = 44
const HEADER_HEIGHT = 56
const WIDE_SEARCH_WIDTH = 300
const NARROW_SEARCH_WIDTH = 220
const QUERY = 'api key'

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)

await runJourney(async ({ page, step, record }) => {
  const field = page.getByRole('searchbox', { name: 'Search' })
  const toggle = page.getByRole('button', { name: 'Search', exact: true })
  const closeSearch = page.getByRole('button', { name: 'Close search' })
  const heading = page.getByRole('heading', { name: 'Media servers' })
  const drawer = page.getByRole('navigation', { name: 'Main menu' })
  /** @type {string[]} */
  const apiRequests = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api')) apiRequests.push(`${request.method()} ${request.url()}`)
  })

  const focusedName = () =>
    page.evaluate(() => {
      const active = document.activeElement
      return active?.getAttribute('aria-label') ?? active?.getAttribute('placeholder') ?? active?.textContent ?? null
    })
  // The box the search button controls holds the icon, the field, and the close button.
  const searchBox = async () =>
    page.evaluate((id) => {
      const rect = id ? document.getElementById(id)?.getBoundingClientRect() : undefined
      return rect ? { top: rect.top, width: rect.width, height: rect.height } : null
    }, await page.getByRole('button', { name: 'Search', exact: true, includeHidden: true }).getAttribute('aria-controls'))
  // The toolbar under the header sticks at this offset on phones.
  const toolbarStickyTop = () =>
    page.evaluate(() => {
      const toolbar = document.querySelector('nav[aria-label="Settings"]')?.parentElement
      return toolbar ? getComputedStyle(toolbar).top : null
    })
  /** @param {number} expected @param {string} message */
  const searchClosed = async (expected, message) => {
    await field.waitFor({ state: 'hidden' })
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', message)
    assert.equal((await heading.boundingBox())?.y, expected, `${message}, and the page moves back up`)
  }

  await page.setViewportSize(DESKTOP)
  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)
  await heading.waitFor()
  apiRequests.length = 0

  assert.equal(await toggle.isVisible(), false, 'desktop shows the field, not the search button')
  const desktopBox = await searchBox()
  assert.equal(desktopBox?.height, DESKTOP_CONTROL_HEIGHT, 'the desktop field is 36px tall')
  assert.equal(desktopBox?.width, WIDE_SEARCH_WIDTH, 'the desktop field is 300px wide above 1100px')
  await field.click()
  await field.fill(QUERY)
  await field.press('Enter')
  await step('desktop-search-typed')

  await page.setViewportSize(NARROW_DESKTOP)
  const narrowBox = await searchBox()
  assert.equal(narrowBox?.width, NARROW_SEARCH_WIDTH, 'the field narrows to 220px at 1100px')

  assert.deepEqual(apiRequests, [], 'typing on desktop sends no request')

  await page.setViewportSize(PHONE)
  await page.reload()
  await heading.waitFor()
  // The reload's session check belongs to the shell, not to search.
  apiRequests.length = 0
  assert.equal(await field.isVisible(), false, 'phones hide the field until search opens')
  const phoneToggle = await toggle.boundingBox()
  assert.equal(phoneToggle?.height, TOUCH_TARGET, 'the search button is 44px tall')
  assert.equal(phoneToggle?.width, TOUCH_TARGET, 'the search button is 44px wide')
  const headingTop = (await heading.boundingBox())?.y ?? Number.NaN
  const closedStickyTop = await toolbarStickyTop()
  await step('phone-home')

  await toggle.click()
  await field.waitFor()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(await focusedName(), 'Search', 'opening search focuses the field')
  const row = await searchBox()
  assert.deepEqual(row, { top: HEADER_HEIGHT, width: PHONE.width, height: HEADER_HEIGHT }, 'search opens as a full-width row under the header')
  const openHeadingTop = (await heading.boundingBox())?.y
  assert.equal(openHeadingTop, headingTop + HEADER_HEIGHT, 'the page moves down by the row height')
  const openStickyTop = await toolbarStickyTop()
  assert.equal(openStickyTop, `${HEADER_HEIGHT * 2}px`, 'the toolbar sticks below the search row')
  const phoneField = await field.boundingBox()
  assert.equal(phoneField?.height, TOUCH_TARGET, 'the phone field is 44px tall')
  const phoneClose = await closeSearch.boundingBox()
  assert.equal(phoneClose?.height, TOUCH_TARGET, 'the close button is 44px tall')
  await step('phone-search-open')

  await field.fill(QUERY)
  await step('phone-search-typed')

  await page.keyboard.press('Escape')
  await searchClosed(headingTop, 'Escape closes search')
  assert.equal(await focusedName(), 'Search', 'Escape returns focus to the search button')
  await step('phone-search-escape')

  await toggle.click()
  await field.waitFor()
  await closeSearch.click()
  await searchClosed(headingTop, 'the close button closes search')
  assert.equal(await focusedName(), 'Search', 'the close button returns focus to the search button')

  await toggle.click()
  await field.waitFor()
  await heading.click()
  await searchClosed(headingTop, 'a click outside the header closes search')
  const focusAfterOutsideClick = await page.evaluate(() => document.activeElement?.tagName)
  assert.notEqual(await focusedName(), 'Search', 'an outside click leaves focus where the click landed')

  await toggle.click()
  await field.waitFor()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await drawer.waitFor()
  await searchClosed(headingTop, 'opening the drawer closes search')
  await step('phone-drawer-over-search')
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'hidden' })

  assert.deepEqual(apiRequests, [], 'search on phones sends no request')
  await record('search-state', {
    desktopBox,
    narrowBox,
    phoneToggle,
    row,
    phoneField,
    phoneClose,
    headingTop: { closed: headingTop, open: openHeadingTop },
    toolbarStickyTop: { closed: closedStickyTop, open: openStickyTop },
    focusAfterOutsideClick,
    apiRequestsDuringSearch: apiRequests,
  })
})
