import { describe, expect, it } from 'vitest'
import type { JellyfinConnection } from '../api/client.ts'
import { API_KEY_MESSAGES, URL_MESSAGES } from './jellyfinChecks.ts'
import { KEY_FOR_HTTP, planSave } from './jellyfinSave.ts'

const SAVED_URL = 'https://jellyfin.home.lan:8920'
const API_KEY = '0123456789abcdef0123456789abcdef'

const NOTHING_SAVED: JellyfinConnection = { url: null, apiKeyState: 'NONE' }
const STORED: JellyfinConnection = { url: SAVED_URL, apiKeyState: 'STORED' }
const UNREADABLE: JellyfinConnection = { url: SAVED_URL, apiKeyState: 'UNREADABLE' }

describe('planSave', () => {
  it('sends nothing when nothing changed', () => {
    expect(planSave(STORED, { url: ` ${SAVED_URL} `, apiKey: '' })).toEqual({ kind: 'unchanged' })
  })

  it('needs a URL and a key on the first save, and sends both trimmed', () => {
    expect(planSave(NOTHING_SAVED, { url: ' http://jf.local:8096 ', apiKey: ` ${API_KEY} ` })).toEqual({
      kind: 'send',
      patch: { url: 'http://jf.local:8096', apiKey: API_KEY },
    })
    expect(planSave(NOTHING_SAVED, { url: 'http://jf.local:8096', apiKey: '' })).toEqual({
      kind: 'invalid',
      errors: { apiKey: API_KEY_MESSAGES.empty },
    })
  })

  it('keeps the saved key on a new URL for the same server, sending only the URL', () => {
    expect(planSave(STORED, { url: 'https://jellyfin.home.lan:8921/jellyfin', apiKey: '' })).toEqual({
      kind: 'send',
      patch: { url: 'https://jellyfin.home.lan:8921/jellyfin' },
    })
  })

  it('asks before the saved key goes to a different server', () => {
    expect(planSave(STORED, { url: 'https://jf.example.net', apiKey: '' })).toEqual({
      kind: 'confirm-host',
      host: 'jf.example.net',
      patch: { url: 'https://jf.example.net' },
    })
  })

  it('asks when an address only looks the same to the browser', () => {
    // The browser reads 010 as octal 8, and java.net.URI reads it as decimal 10, so these are two machines.
    const saved: JellyfinConnection = { url: 'https://192.168.1.8', apiKeyState: 'STORED' }
    expect(planSave(saved, { url: 'https://192.168.001.010', apiKey: '' })).toMatchObject({
      kind: 'confirm-host',
      host: '192.168.001.010',
    })
  })

  it('treats a hostname written in another case as the same server', () => {
    expect(planSave(STORED, { url: 'https://JellyFin.Home.Lan:8920/jf', apiKey: '' })).toMatchObject({ kind: 'send' })
  })

  it('sends a typed key with a new server without asking', () => {
    expect(planSave(STORED, { url: 'https://jf.example.net', apiKey: API_KEY })).toEqual({
      kind: 'send',
      patch: { url: 'https://jf.example.net', apiKey: API_KEY },
    })
  })

  it('sends only the key when only the key changed', () => {
    expect(planSave(STORED, { url: SAVED_URL, apiKey: API_KEY })).toEqual({ kind: 'send', patch: { apiKey: API_KEY } })
  })

  it('needs the key again to move from https to http', () => {
    expect(planSave(STORED, { url: 'http://jellyfin.home.lan:8096', apiKey: '' })).toEqual({
      kind: 'invalid',
      errors: { apiKey: KEY_FOR_HTTP },
    })
  })

  it('needs a key when the saved one can no longer be read', () => {
    expect(planSave(UNREADABLE, { url: 'https://jellyfin.home.lan:8921', apiKey: '' })).toEqual({
      kind: 'invalid',
      errors: { apiKey: API_KEY_MESSAGES.empty },
    })
  })

  it('names every field that is wrong', () => {
    expect(planSave(STORED, { url: 'jellyfin.home.lan', apiKey: 'has a space' })).toEqual({
      kind: 'invalid',
      errors: { url: URL_MESSAGES.scheme, apiKey: API_KEY_MESSAGES.characters },
    })
  })
})
