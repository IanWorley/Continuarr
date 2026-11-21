import { queryOptions } from '@tanstack/react-query'
import { fetchJellyfinConnection, fetchPlexConnection, type JellyfinConnection, type PlexConnection } from '../api/client.ts'

// The media servers the page can show a card for. The backend stores one connection of each.

export const SERVER_KINDS = ['jellyfin', 'plex'] as const
export type ServerKind = (typeof SERVER_KINDS)[number]

export const SERVER_NAMES: Record<ServerKind, string> = { jellyfin: 'Jellyfin', plex: 'Plex' }

// Each card's load-failed banner has its own Retry, so it appears at once instead of after several silent tries.
export const jellyfinConnectionQuery = queryOptions({
  queryKey: ['jellyfin-connection'],
  queryFn: fetchJellyfinConnection,
  retry: false,
})

export const plexConnectionQuery = queryOptions({
  queryKey: ['plex-connection'],
  queryFn: fetchPlexConnection,
  retry: false,
})

export const isJellyfinConfigured = (saved: JellyfinConnection): boolean =>
  Boolean(saved.url) || saved.apiKeyState === 'STORED'

// A saved URL with no token is still configured: it's a link that needs renewing.
export const isPlexConfigured = (saved: PlexConnection): boolean => Boolean(saved.url)

/** What the page reads from a card when the admin asks to reload. */
export interface CardHandle {
  readonly unsaved: boolean
}
