import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useId, useRef, useState } from 'react'
import { Banner, SECONDARY_BUTTON_CLASSES, UNAVAILABLE_BUTTON_CLASSES } from '../auth/formParts.tsx'
import { Icon } from '../shell/Icon.tsx'
import { focusOnMount } from './focus.ts'
import { JellyfinCard } from './JellyfinCard.tsx'
import { PlexCard } from './PlexCard.tsx'
import {
  isJellyfinConfigured,
  isPlexConfigured,
  jellyfinConnectionQuery,
  plexConnectionQuery,
  SERVER_KINDS,
  SERVER_NAMES,
  type CardHandle,
  type ServerKind,
} from './servers.ts'

export const MEDIA_SERVERS_PATH = '/settings/media-servers'

const SERVER_LIST = new Intl.ListFormat('en', { type: 'conjunction' })

/**
 * Whether a server has a saved connection, or undefined until its settings load. A load that ever failed counts as
 * yes, so the card and its Retry stay on screen, including while a retry resets the query to pending.
 */
type Configured = Record<ServerKind, boolean | undefined>

export function MediaServersPage() {
  const jellyfin = useQuery(jellyfinConnectionQuery)
  const plex = useQuery(plexConnectionQuery)
  // Unconfigured servers the admin added this visit. They have no card until added, and keep it once shown.
  const [added, setAdded] = useState<ReadonlySet<ServerKind>>(new Set())
  // Bumped by Reload. Each card remounts, so its unsaved edits and last outcome are discarded.
  const [generation, setGeneration] = useState(0)
  const [reloading, setReloading] = useState(false)
  const [discarding, setDiscarding] = useState<readonly ServerKind[]>()
  const cards = useRef<Partial<Record<ServerKind, CardHandle | null>>>({})
  const focusOnAdd = useRef<ServerKind>(undefined)
  const reloadButton = useRef<HTMLButtonElement>(null)

  const configured: Configured = {
    jellyfin: jellyfin.data ? isJellyfinConfigured(jellyfin.data) : jellyfin.errorUpdateCount > 0 || undefined,
    plex: plex.data ? isPlexConfigured(plex.data) : plex.errorUpdateCount > 0 || undefined,
  }
  const loading = SERVER_KINDS.some((kind) => configured[kind] === undefined)
  const shown = SERVER_KINDS.filter((kind) => added.has(kind) || configured[kind])
  const addable = loading ? [] : SERVER_KINDS.filter((kind) => !shown.includes(kind))

  function keep(kind: ServerKind) {
    setAdded((current) => new Set(current).add(kind))
  }

  function add(kind: ServerKind) {
    focusOnAdd.current = kind
    keep(kind)
  }

  async function reload() {
    // Discard changes is about to disappear, so focus goes back to the button that asked.
    reloadButton.current?.focus()
    setDiscarding(undefined)
    setReloading(true)
    await Promise.all([jellyfin.refetch(), plex.refetch()])
    setGeneration((current) => current + 1)
    setReloading(false)
  }

  function cancelReload() {
    reloadButton.current?.focus()
    setDiscarding(undefined)
  }

  function askToReload() {
    if (reloading) return
    const unsaved = shown.filter((kind) => cards.current[kind]?.unsaved)
    if (unsaved.length > 0) {
      setDiscarding(unsaved)
    } else {
      void reload()
    }
  }

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
        <div className="ml-auto flex gap-2 py-1.5">
          <AddServer kinds={addable} onAdd={add} />
          <button
            ref={reloadButton}
            type="button"
            aria-disabled={reloading}
            onClick={askToReload}
            className={`${SECONDARY_BUTTON_CLASSES} ${UNAVAILABLE_BUTTON_CLASSES}`}
          >
            <Icon name="refresh" className={`size-3.75 ${reloading ? 'motion-safe:animate-spin' : ''}`} />
            Reload
          </button>
        </div>
      </div>
      <div className="max-w-page px-3 pt-3.5 pb-8 tablet:px-5 tablet:pt-4.5 tablet:pb-10">
        <h1 className="text-2xl font-semibold">Media servers</h1>
        <p className="mt-0.5 text-ink-400">
          The servers Continuarr reads watch history from. Each card saves on its own.
        </p>
        <div aria-live="polite">
          {discarding && (
            <ReloadConfirm servers={discarding} onCancel={cancelReload} onDiscard={() => void reload()} />
          )}
        </div>
        {/* Two cards side by side above 1100px, stacked below. */}
        <div className="mt-4 grid items-start gap-4 wide:grid-cols-2">
          {shown.map((kind) => (
            <div
              key={`${kind}-${generation}`}
              ref={(element) => {
                if (element && focusOnAdd.current === kind) {
                  focusOnAdd.current = undefined
                  element.querySelector('h2')?.focus()
                }
              }}
              className="min-w-0"
            >
              {kind === 'jellyfin' ? (
                <JellyfinCard
                  ref={(handle) => {
                    cards.current.jellyfin = handle
                  }}
                />
              ) : (
                <PlexCard onUnlinked={() => keep('plex')} />
              )}
            </div>
          ))}
        </div>
        {loading ? (
          <p aria-busy="true" className="mt-4 text-ink-400">
            Loading media servers…
          </p>
        ) : (
          shown.length === 0 && (
            <div className="mt-4 rounded-lg border border-dashed border-ink-700 px-4 py-6 text-center">
              <p className="font-semibold">No media servers yet.</p>
              <p className="mt-0.5 text-ink-400">Use Add server to connect Jellyfin or Plex.</p>
            </div>
          )
        )}
      </div>
    </>
  )
}

interface ReloadConfirmProps {
  servers: readonly ServerKind[]
  onCancel: () => void
  onDiscard: () => void
}

function ReloadConfirm({ servers, onCancel, onDiscard }: ReloadConfirmProps) {
  const question = `Discard unsaved changes to ${SERVER_LIST.format(servers.map((kind) => SERVER_NAMES[kind]))}?`
  return (
    <div className="mt-4">
      <Banner
        tone="warn"
        title={question}
        action={
          <div className="flex gap-2">
            <button type="button" ref={focusOnMount} onClick={onCancel} className={SECONDARY_BUTTON_CLASSES}>
              Cancel
            </button>
            <button type="button" onClick={onDiscard} className={SECONDARY_BUTTON_CLASSES}>
              Discard changes
            </button>
          </div>
        }
      >
        Reload shows what's saved and drops what you typed.
      </Banner>
    </div>
  )
}

interface AddServerProps {
  kinds: readonly ServerKind[]
  onAdd: (kind: ServerKind) => void
}

/**
 * Offers each server type that has no card yet, and is gone once every type has one. A native popover, so the
 * browser closes it on Escape or a click elsewhere and tells assistive tech whether it's open.
 */
function AddServer({ kinds, onAdd }: AddServerProps) {
  const listId = useId()
  const list = useRef<HTMLUListElement>(null)
  if (kinds.length === 0) return null

  return (
    <>
      <button type="button" popoverTarget={listId} className={`[anchor-name:--add-server] ${SECONDARY_BUTTON_CLASSES}`}>
        <Icon name="plus" className="size-3.75" />
        Add server
      </button>
      <ul
        ref={list}
        id={listId}
        popover="auto"
        aria-label="Server types"
        className="m-0 mt-1 min-w-36 rounded-md border border-ink-700 bg-ink-850 p-1 text-ink-100 shadow-lg [position-anchor:--add-server] [inset:auto] [top:anchor(bottom)] [right:anchor(right)]"
      >
        {kinds.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              onClick={() => {
                // Before onAdd, which removes this button, and a removed button can't close its popover.
                list.current?.hidePopover()
                onAdd(kind)
              }}
              className="flex h-touch w-full items-center rounded-sm px-3 text-left whitespace-nowrap hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-accent tablet:h-control"
            >
              {SERVER_NAMES[kind]}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
