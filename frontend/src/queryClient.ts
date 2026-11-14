import { QueryClient } from '@tanstack/react-query'

// Query's default networkMode pauses a mutation while the browser reports offline, so Sign out
// would sit on "Signing out…" with no way out. Continuarr is self-hosted and often reached over a
// LAN, where the browser's offline guess is unreliable, so mutations try anyway and a failed
// request ends in a "Couldn't reach Continuarr" message.
//
// Queries keep the default: a paused poll resumes by itself once the browser is back online, and
// no button is stuck waiting on it.
export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { networkMode: 'always' },
  },
})
