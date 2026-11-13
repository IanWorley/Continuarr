// Mirrors parseBaseUrlOrNull and JellyfinApiKey.parseOrNull in JellyfinConnection.kt, so the card names
// what to fix before a save the server would refuse. Callers trim first, because the server doesn't.

const MAX_PORT = 65_535
// java.net.URI's server-based host is a hostname, a dotted IPv4 address, or a bracketed IPv6 one. A hostname's
// last label must start with a letter only when it has more than one label, so `http://1` is a valid host.
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i
const STARTS_WITH_LETTER = /^[a-z]/i
// java.net.URI reads each octet as any run of digits worth 255 or less, so 192.168.001.010 is allowed.
const IPV4_OCTET = String.raw`0*(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`
const IPV4 = new RegExp(String.raw`^(?:${IPV4_OCTET}\.){3}${IPV4_OCTET}$`)
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i
const IPV6_GROUPS = 8
// At most one '::', which splits an address into the groups before it and the groups after it.
const IPV6_MAX_HALVES = 2
const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i
const AUTHORITY = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/
const HTTP_SCHEME = /^https?$/i
// Whitespace java.net.URI refuses. JavaScript's \s also matches U+FEFF, which java.net.URI allows in a path.
const WHITESPACE = /[^\S\uFEFF]/
const QUERY_FRAGMENT_OR_PERCENT = /[?#%]/
// java.net.URI path characters: unreserved, the sub-delimiters it allows, '/', and anything outside ASCII except
// the C1 control characters U+0080 to U+009F. Whitespace outside ASCII is refused earlier, by WHITESPACE.
const PATH = /^[a-z0-9\-_.!~*'();:@&=+$,/\u00a0-\uffff]*$/i
// Visible ASCII from '!' to '~', minus the quote and backslash the Authorization header value can't hold.
const API_KEY = /^[!#-[\]-~]+$/

export const URL_MESSAGES = {
  empty: 'Enter the server address, like http://jellyfin.local:8096.',
  scheme: 'Start the address with http:// or https://.',
  spaces: 'Remove the spaces from the address.',
  extraParts: 'Use only the server address and port. Remove any ?, #, %, or name@ part.',
  underscore: "Server names can't contain _. Use the server's IP address or a name without it.",
  host: 'Use a server name like jellyfin.local or an IP address like 192.168.1.10.',
  port: 'Use a port from 1 to 65535.',
  path: 'Remove characters like < > [ ] { } | \\ ^ ` or " from the path.',
} as const

export const API_KEY_MESSAGES = {
  empty: 'Paste the API key. Continuarr needs it on every save. Copy it from Jellyfin under Dashboard › API Keys.',
  characters:
    'Jellyfin keys never contain spaces, quotes, backslashes, or accented letters. Copy the key again from Dashboard › API Keys.',
} as const

function isIpv6(literal: string): boolean {
  const halves = literal.split('::')
  if (halves.length > IPV6_MAX_HALVES) return false
  const groups = halves.flatMap((half) => (half ? half.split(':') : []))
  const tail = groups.at(-1) ?? ''
  // An IPv4 part is only allowed as the very end of the address, never before a '::'.
  const endsInIpv4 = IPV4.test(tail) && literal.endsWith(tail)
  const width = endsInIpv4 ? groups.length + 1 : groups.length
  const hexGroups = endsInIpv4 ? groups.slice(0, -1) : groups
  if (!hexGroups.every((group) => IPV6_GROUP.test(group))) return false
  return halves.length === IPV6_MAX_HALVES ? width < IPV6_GROUPS : width === IPV6_GROUPS
}

function isHost(host: string): boolean {
  if (host.startsWith('[')) return host.endsWith(']') && isIpv6(host.slice(1, -1))
  return IPV4.test(host) || isHostname(host)
}

function isHostname(host: string): boolean {
  const labels = (host.endsWith('.') ? host.slice(0, -1) : host).split('.')
  if (!labels.every((label) => HOSTNAME_LABEL.test(label))) return false
  return labels.length === 1 || STARTS_WITH_LETTER.test(labels.at(-1) ?? '')
}

/** What to fix in a trimmed server URL, or null when the server will accept it. */
export function checkUrl(url: string): string | null {
  if (!url) return URL_MESSAGES.empty
  const parts = URL_PARTS.exec(url)
  if (!parts?.[1] || !HTTP_SCHEME.test(parts[1])) return URL_MESSAGES.scheme
  const authority = parts[2] ?? ''
  const path = parts[3] ?? ''
  if (WHITESPACE.test(url)) return URL_MESSAGES.spaces
  if (QUERY_FRAGMENT_OR_PERCENT.test(url) || authority.includes('@')) return URL_MESSAGES.extraParts
  const hostPort = AUTHORITY.exec(authority)
  const host = hostPort?.[1] ?? ''
  if (host.includes('_')) return URL_MESSAGES.underscore
  if (!hostPort || !isHost(host)) return URL_MESSAGES.host
  const port = hostPort[2]
  if (port !== undefined && port !== '' && !(Number(port) >= 1 && Number(port) <= MAX_PORT)) return URL_MESSAGES.port
  if (!PATH.test(path)) return URL_MESSAGES.path
  return null
}

/** What to fix in a trimmed API key, or null when the server will accept it. */
export function checkApiKey(apiKey: string): string | null {
  if (!apiKey) return API_KEY_MESSAGES.empty
  return API_KEY.test(apiKey) ? null : API_KEY_MESSAGES.characters
}
