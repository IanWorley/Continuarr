import { Link } from '@tanstack/react-router'
import type { Ref } from 'react'
import { MEDIA_SERVERS_PATH } from '../settings/MediaServersPage.tsx'
import { Icon, type IconName } from './Icon.tsx'

/** A destination in the main navigation. One without `to` has no page yet and shows as coming later. */
interface NavItem {
  label: string
  icon: IconName
  to?: typeof MEDIA_SERVERS_PATH
}

const SEPARATOR = 'separator'

const NAV_ENTRIES: readonly (NavItem | typeof SEPARATOR)[] = [
  { label: 'Now Playing', icon: 'play' },
  { label: 'Queue', icon: 'list' },
  { label: 'People', icon: 'users' },
  { label: 'History', icon: 'clock' },
  SEPARATOR,
  { label: 'Settings', icon: 'gear', to: MEDIA_SERVERS_PATH },
  { label: 'System', icon: 'pulse' },
]

const ITEM_FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-accent'
// An amber bar on the left edge marks the current page.
const CURRENT_ITEM =
  'aria-[current=page]:bg-ink-800 aria-[current=page]:text-ink-100 aria-[current=page]:before:absolute ' +
  'aria-[current=page]:before:inset-y-2 aria-[current=page]:before:left-0 aria-[current=page]:before:w-0.75 ' +
  'aria-[current=page]:before:rounded-r-sm aria-[current=page]:before:bg-accent'
const RAIL_ITEM = 'group relative grid h-12 place-items-center'
const DRAWER_ITEM = 'relative flex h-12 items-center gap-3 px-4.5 font-medium'
const LINK_ITEM = `text-ink-400 hover:bg-ink-800 hover:text-ink-100 ${ITEM_FOCUS} ${CURRENT_ITEM}`
const LATER_ITEM = 'cursor-not-allowed text-ink-500'

function Separator() {
  return <hr className="mx-3 my-1.5 border-ink-700" />
}

function LaterTag() {
  return (
    <span className="inline-flex items-center rounded-sm border border-dashed border-ink-500 px-1.25 text-xs font-semibold tracking-wide whitespace-nowrap text-ink-400 uppercase tablet:text-tag">
      Later
    </span>
  )
}

/** The rail's label: hidden until the item is hovered or focused, and always its accessible name. */
function Tip({ item }: { item: NavItem }) {
  return (
    <span className="pointer-events-none absolute left-full ml-1.5 flex -translate-x-1 items-center gap-2 rounded-sm bg-ink-700 px-2 py-1 text-xs whitespace-nowrap text-ink-100 opacity-0 transition before:absolute before:top-1/2 before:right-full before:-mt-1 before:border-4 before:border-l-0 before:border-transparent before:border-r-ink-700 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
      {item.label}
      {!item.to && <LaterTag />}
    </span>
  )
}

/** The icon-only navigation down the left edge, from tablet width up. */
export function NavRail({ inert }: { inert: boolean }) {
  return (
    <nav
      aria-label="Main"
      inert={inert}
      className="fixed top-header bottom-0 left-0 z-20 hidden w-rail border-r border-ink-700 bg-ink-900 pt-1.5 tablet:block"
    >
      {NAV_ENTRIES.map((entry) =>
        entry === SEPARATOR ? (
          <Separator key={SEPARATOR} />
        ) : entry.to ? (
          <Link key={entry.label} to={entry.to} className={`${RAIL_ITEM} ${LINK_ITEM}`}>
            <Icon name={entry.icon} />
            <Tip item={entry} />
          </Link>
        ) : (
          <span key={entry.label} className={`${RAIL_ITEM} ${LATER_ITEM}`}>
            <Icon name={entry.icon} />
            <Tip item={entry} />
          </span>
        ),
      )}
    </nav>
  )
}

export interface NavDrawerProps {
  open: boolean
  onNavigate: () => void
  ref: Ref<HTMLElement>
}

/** The labelled menu the hamburger opens. It sits below the header, so the hamburger can still close it. */
export function NavDrawer({ open, onNavigate, ref }: NavDrawerProps) {
  return (
    <nav
      ref={ref}
      id="drawer"
      aria-label="Main menu"
      hidden={!open}
      className="fixed top-header bottom-0 left-0 z-50 w-drawer overflow-y-auto border-r border-ink-700 bg-ink-900 pt-1.5"
    >
      {NAV_ENTRIES.map((entry) =>
        entry === SEPARATOR ? (
          <Separator key={SEPARATOR} />
        ) : entry.to ? (
          <Link key={entry.label} to={entry.to} onClick={onNavigate} className={`${DRAWER_ITEM} ${LINK_ITEM}`}>
            <Icon name={entry.icon} />
            {entry.label}
          </Link>
        ) : (
          <span key={entry.label} className={`${DRAWER_ITEM} ${LATER_ITEM}`}>
            <Icon name={entry.icon} />
            {entry.label}
            <LaterTag />
          </span>
        ),
      )}
    </nav>
  )
}
