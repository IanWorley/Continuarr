import { describe, expect, it } from 'vitest'
import { API_KEY_MESSAGES, checkApiKey, checkUrl, URL_MESSAGES } from './jellyfinChecks.ts'

describe('checkUrl', () => {
  it.each([
    'http://jellyfin.local:8096',
    'https://jf.example.net',
    'HTTP://Jellyfin.Local:8096',
    'http://192.168.1.10:8096',
    'http://[::1]:8096',
    'http://[2001:db8::ffff:192.168.1.10]',
    'http://localhost',
    'http://jellyfin.local:8096/',
    'http://jellyfin.local:8096/jelly-fin/~x;y=1',
    'http://jellyfin.local:',
  ])('accepts %s', (url) => {
    expect(checkUrl(url)).toBeNull()
  })

  it.each([
    { url: '', message: URL_MESSAGES.empty },
    { url: 'jellyfin.home.lan:8096', message: URL_MESSAGES.scheme },
    { url: 'ftp://jellyfin.local', message: URL_MESSAGES.scheme },
    { url: 'http://jelly fin.local', message: URL_MESSAGES.spaces },
    { url: 'http://jellyfin.local:8096/?x=1', message: URL_MESSAGES.extraParts },
    { url: 'http://jellyfin.local:8096/#top', message: URL_MESSAGES.extraParts },
    { url: 'http://jellyfin.local:8096/a%20b', message: URL_MESSAGES.extraParts },
    { url: 'http://user:pass@jellyfin.local:8096', message: URL_MESSAGES.extraParts },
    { url: 'http://jelly_fin.local:8096', message: URL_MESSAGES.underscore },
    { url: 'http://999.1.1.1:8096', message: URL_MESSAGES.host },
    { url: 'http://-jellyfin.local', message: URL_MESSAGES.host },
    { url: 'http://[::g]:8096', message: URL_MESSAGES.host },
    { url: 'http://jellyfin.local:0', message: URL_MESSAGES.port },
    { url: 'http://jellyfin.local:65536', message: URL_MESSAGES.port },
    { url: 'http://jellyfin.local:8096/a<b', message: URL_MESSAGES.path },
    { url: 'http://jellyfin.local:8096/a"b', message: URL_MESSAGES.path },
  ])('names what to fix in $url', ({ url, message }) => {
    expect(checkUrl(url)).toBe(message)
  })
})

describe('checkApiKey', () => {
  it.each(['0123456789abcdef0123456789abcdef', '!#$%&()*+,-./:;<=>?@[]^_`{|}~'])('accepts %s', (apiKey) => {
    expect(checkApiKey(apiKey)).toBeNull()
  })

  it.each([
    { apiKey: '', message: API_KEY_MESSAGES.empty },
    { apiKey: 'has a space', message: API_KEY_MESSAGES.characters },
    { apiKey: 'quote"key', message: API_KEY_MESSAGES.characters },
    { apiKey: 'back\\slash', message: API_KEY_MESSAGES.characters },
    { apiKey: 'clé', message: API_KEY_MESSAGES.characters },
  ])('names what to fix in $apiKey', ({ apiKey, message }) => {
    expect(checkApiKey(apiKey)).toBe(message)
  })
})
