import { Link } from '@tanstack/react-router'
import { JellyfinCard } from './JellyfinCard.tsx'

export const MEDIA_SERVERS_PATH = '/settings/media-servers'

export function MediaServersPage() {
  return (
    <>
      {/* Sticks under the header on phones, where the page scrolls past a long stack of cards. */}
      <div className="sticky top-header z-10 flex min-h-toolbar flex-wrap items-center gap-x-2 gap-y-1 border-b border-ink-700 bg-ink-850 px-2 tablet:static tablet:px-5">
        <nav aria-label="Settings" className="flex gap-0.5 self-stretch">
          <Link
            to={MEDIA_SERVERS_PATH}
            className="flex min-h-touch items-center border-b-2 border-transparent px-3 font-medium text-ink-400 hover:text-ink-100 focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-accent aria-[current=page]:border-ink-100 aria-[current=page]:text-ink-100 tablet:min-h-0"
          >
            Media servers
          </Link>
        </nav>
      </div>
      <div className="max-w-page px-3 pt-3.5 pb-8 tablet:px-5 tablet:pt-4.5 tablet:pb-10">
        <h1 className="text-2xl font-semibold">Media servers</h1>
        <p className="mt-0.5 text-ink-400">
          The servers Continuarr reads watch history from. Each card saves on its own.
        </p>
        {/* Two cards side by side above 1100px once Plex joins, stacked below. */}
        <div className="mt-4 grid items-start gap-4 wide:grid-cols-2">
          <JellyfinCard />
        </div>
      </div>
    </>
  )
}
