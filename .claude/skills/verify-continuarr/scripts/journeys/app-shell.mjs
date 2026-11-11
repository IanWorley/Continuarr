import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FRONTEND_URL, RUN_DIR, runJourney } from '../journey.mjs'

const HOME_PATH = '/settings/media-servers'
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
// A point on the scrim, right of the 240px drawer and below the 56px header.
const SCRIM_POINT = { x: 800, y: 400 }
const DESKTOP_CONTROL_HEIGHT = 36
const TOUCH_TARGET = 44

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)

await runJourney(async ({ page, step, record }) => {
  const openNav = page.getByRole('button', { name: 'Open navigation' })
  const closeNav = page.getByRole('button', { name: 'Close navigation' })
  const drawer = page.getByRole('navigation', { name: 'Main menu' })
  const rail = page.getByRole('navigation', { name: 'Main', exact: true })
  const signOut = page.getByRole('button', { name: 'Sign out' })
  const drawerSettings = drawer.getByRole('link', { name: 'Settings' })
  const focusedName = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent)
  // Waits out hover and resize transitions so a screenshot shows where they end.
  const settle = () => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
  const pageState = () =>
    page.evaluate(() => ({
      htmlClass: document.documentElement.className,
      mainInert: document.querySelector('main')?.inert ?? null,
      bodyOverflow: getComputedStyle(document.documentElement).overflow,
      pageBackground: getComputedStyle(document.querySelector('main')?.parentElement ?? document.body).backgroundColor,
    }))

  await page.setViewportSize(DESKTOP)
  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)
  await page.getByRole('heading', { name: 'Media servers' }).waitFor()
  assert.equal(await rail.getByRole('link', { name: 'Settings' }).getAttribute('aria-current'), 'page')
  const desktopSignOutHeight = (await signOut.boundingBox())?.height
  assert.equal(desktopSignOutHeight, DESKTOP_CONTROL_HEIGHT, 'desktop controls are 36px')
  const closed = await pageState()
  await step('desktop-home')

  await rail.getByRole('link', { name: 'Settings' }).hover()
  await settle()
  await step('desktop-rail-tip')

  await openNav.click()
  await drawerSettings.waitFor()
  assert.equal(await closeNav.getAttribute('aria-expanded'), 'true')
  assert.equal(await focusedName(), 'Settings', 'opening the drawer focuses its first link')
  const open = await pageState()
  assert.equal(open.mainInert, true, 'the page is inert behind the drawer')
  assert.equal(open.bodyOverflow, 'hidden', 'the page does not scroll behind the drawer')
  await step('desktop-drawer-open')

  await page.keyboard.press('Tab')
  const afterTab = await focusedName()
  await page.keyboard.press('Tab')
  const afterSecondTab = await focusedName()
  assert.deepEqual([afterTab, afterSecondTab], ['Close navigation', 'Settings'], 'Tab stays on the hamburger and drawer links')

  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(await focusedName(), 'Open navigation', 'Escape returns focus to the hamburger')
  await step('desktop-drawer-escape')

  await openNav.click()
  await drawerSettings.waitFor()
  await page.mouse.click(SCRIM_POINT.x, SCRIM_POINT.y)
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(await focusedName(), 'Open navigation', 'the scrim returns focus to the hamburger')

  await openNav.click()
  await drawerSettings.click()
  await drawer.waitFor({ state: 'hidden' })
  assert.match(page.url(), new RegExp(`${HOME_PATH}$`))

  await page.setViewportSize(PHONE)
  await page.reload()
  await page.getByRole('heading', { name: 'Media servers' }).waitFor()
  assert.equal(await rail.isVisible(), false, 'phones hide the rail')
  const phoneSignOut = await signOut.boundingBox()
  assert.equal(phoneSignOut?.height, TOUCH_TARGET, 'phone controls are 44px')
  assert.equal(phoneSignOut?.width, TOUCH_TARGET, 'Sign out is an icon button on phones')
  await step('phone-home')

  await openNav.click()
  await drawerSettings.waitFor()
  await step('phone-drawer-open')
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'hidden' })

  await record('shell-state', {
    closed,
    open,
    tabOrder: [afterTab, afterSecondTab],
    desktopSignOutHeight,
    phoneSignOut,
  })
})
