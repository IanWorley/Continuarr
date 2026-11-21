import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKEND_URL, FRONTEND_URL, RUN_DIR, runJourney, runSql } from '../journey.mjs'

const HOME_PATH = '/settings/media-servers'
const PLEX_PATH = '/api/v1/plex/connection'
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const TOUCH_TARGET = 44
const TYPED_URL = 'http://jellyfin.verify.local:8096'
const NOTHING_SAVED = { url: null, source: null, tokenState: 'NONE' }

// The launch read these from the same shell, so the journey knows what it seeded and which token must never leak.
const plexUrl = process.env.CONTINUARR_PLEX_URL ?? ''
const plexToken = process.env.CONTINUARR_PLEX_TOKEN ?? ''
if (!plexUrl || !plexToken) throw new Error('Launch and drive with CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN set')

/** @type {{ username: string, password: string }} */
const admin = JSON.parse(
  await readFile(join(RUN_DIR, 'admin-credentials.json'), 'utf8').catch(() => {
    throw new Error('No admin recorded for this run; drive first-run-setup first')
  }),
)
const backendLog = join((await readFile(join(RUN_DIR, 'evidence-dir'), 'utf8')).trim(), 'backend.log')

await runJourney(async ({ page, step, record }) => {
  const jellyfin = page.getByRole('region', { name: 'Jellyfin' })
  const plex = page.getByRole('region', { name: 'Plex' })
  const addServer = page.getByRole('button', { name: 'Add server' })
  const reload = page.getByRole('button', { name: 'Reload' })
  const pick = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })
  const readPlex = async () => {
    const response = await page.request.get(`${FRONTEND_URL}${PLEX_PATH}`)
    const text = await response.text()
    assert.ok(!text.includes(plexToken), 'GET never returns the Plex token')
    return { status: response.status(), body: JSON.parse(text) }
  }
  const comingLater = async (/** @type {import('playwright-core').Locator} */ card) => {
    const zone = card.getByRole('group', { name: 'Sync Later' })
    const sync = zone.getByRole('switch')
    return {
      zoneDisabled: await zone.isDisabled(),
      switchAriaDisabled: await sync.getAttribute('aria-disabled'),
      switchFocusable: await sync.evaluate((element) => element.tabIndex >= 0),
    }
  }

  await page.setViewportSize(DESKTOP)
  await page.goto(`${FRONTEND_URL}/login`)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${FRONTEND_URL}${HOME_PATH}`)
  await plex.getByText('Seeded from CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN.').waitFor()
  await plex.getByText('Linked', { exact: true }).waitFor()
  assert.equal(await jellyfin.count(), 0, 'Jellyfin has nothing saved, so it has no card')
  assert.equal(await plex.getByRole('button', { name: 'Re-link' }).getAttribute('aria-disabled'), 'true', 'Re-link waits for plex.tv linking')
  const plexZone = await comingLater(plex)
  assert.deepEqual(plexZone, { zoneDisabled: true, switchAriaDisabled: 'true', switchFocusable: false }, 'the sync zone is inert')
  await step('desktop-plex-seeded')

  await addServer.click()
  assert.equal(await pick('Plex').count(), 0, 'Add server leaves out Plex, which has a card')
  await step('desktop-add-server-open')
  await pick('Jellyfin').click()
  await jellyfin.getByText('Nothing saved yet.').waitFor()
  assert.equal(await addServer.count(), 0, 'Add server goes away once both servers have a card')
  const focusedHeading = await page.evaluate(() => document.activeElement?.textContent ?? null)
  assert.equal(focusedHeading, 'Jellyfin', 'focus moves to the added card')
  const jellyfinZone = await comingLater(jellyfin)
  assert.deepEqual(jellyfinZone, plexZone, 'both cards have the same inert sync zone')
  await step('desktop-both-cards')

  const urlField = jellyfin.getByLabel('Server URL')
  await urlField.fill(TYPED_URL)
  await reload.click()
  await page.getByText('Discard unsaved changes to Jellyfin?').waitFor()
  await step('desktop-reload-asks')
  await page.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(await urlField.inputValue(), TYPED_URL, 'Cancel keeps what was typed')
  await reload.click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await page.getByRole('button', { name: 'Reload', disabled: false }).waitFor()
  assert.equal(await urlField.inputValue(), '', 'Discard changes puts back what is saved')
  await step('desktop-reload-discarded')

  await runSql("UPDATE plex_connection SET source = 'PLEX_TV'")
  await reload.click()
  await plex.getByText('Linked through plex.tv.').waitFor()
  await step('desktop-plex-linked-plex-tv-set-by-sql')

  await runSql('UPDATE plex_connection SET token = NULL')
  await reload.click()
  await plex.getByText('Your Plex link expired.').waitFor()
  await plex.getByText('Re-link needed').waitFor()
  assert.equal(
    await plex.getByRole('button', { name: 'Re-link with plex.tv' }).getAttribute('aria-disabled'),
    'true',
    'Re-link with plex.tv waits for plex.tv linking',
  )
  const expired = await readPlex()
  await step('desktop-plex-expired-token-cleared-by-sql')

  await plex.getByRole('button', { name: 'Unlink' }).click()
  await plex.getByText('Unlink Plex?').waitFor()
  await step('desktop-unlink-asks')
  await plex.getByRole('button', { name: 'Unlink' }).click()
  await plex.getByText('Unlinked. Continuarr no longer reads from this server.').waitFor()
  await plex.getByText('Not linked', { exact: true }).waitFor()
  const unlinked = await readPlex()
  assert.deepEqual(unlinked.body, NOTHING_SAVED, 'Unlink removed the saved connection')
  await step('desktop-unlinked')

  await page.reload()
  await page.getByText('No media servers yet.').waitFor()
  await addServer.click()
  assert.deepEqual(
    await page.getByRole('list', { name: 'Server types' }).getByRole('button').allTextContents(),
    ['Jellyfin', 'Plex'],
    'with nothing saved, Add server offers both',
  )
  await step('desktop-empty')
  await page.keyboard.press('Escape')

  const anonymousUnlink = await fetch(`${BACKEND_URL}${PLEX_PATH}`, { method: 'DELETE' })
  assert.ok(anonymousUnlink.status >= 400, 'Unlink without a session is refused')

  await page.setViewportSize(PHONE)
  await page.reload()
  await page.getByText('No media servers yet.').waitFor()
  await step('phone-empty')
  await addServer.click()
  await pick('Plex').click()
  await plex.getByText('Not linked', { exact: true }).waitFor()
  await addServer.click()
  await pick('Jellyfin').click()
  await jellyfin.getByText('Nothing saved yet.').waitFor()
  const phoneReload = await reload.boundingBox()
  assert.ok(phoneReload, 'Reload is on screen')
  assert.equal(phoneReload.height, TOUCH_TARGET, 'phone toolbar buttons are 44px')
  await step('phone-both-cards')

  assert.ok(!(await readFile(backendLog, 'utf8')).includes(plexToken), 'the backend log never holds the Plex token')
  await record('media-servers', {
    comingLater: plexZone,
    expired: expired.body,
    unlinked,
    anonymousUnlinkStatus: anonymousUnlink.status,
    phoneReloadHeight: phoneReload.height,
    tokenInResponsesOrBackendLog: false,
  })
})
