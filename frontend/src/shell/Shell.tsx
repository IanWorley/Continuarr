import { useMutation } from '@tanstack/react-query'
import { Outlet, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { logout } from '../api/client.ts'
import { Icon } from './Icon.tsx'
import { NavDrawer, NavRail } from './nav.tsx'

const DRAWER_OPEN_CLASS = 'drawer-open'

/** What sits over or above the page. Opening one closes the other. Search only opens on phones, as a row under the header. */
type Overlay = 'drawer' | 'search' | null

const ICON_BUTTON =
  'grid size-touch flex-none place-items-center rounded-md hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:bg-ink-800'
// One ring on the field box, never a second one on the input inside it.
const SEARCH_FIELD =
  'items-center gap-2 border-ink-700 text-ink-400 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-accent ' +
  'tablet:flex tablet:h-control tablet:w-55 tablet:flex-none tablet:rounded-md tablet:border tablet:bg-ink-950 tablet:px-2.5 tablet:has-[input:focus-visible]:-outline-offset-1 wide:w-75'
const SEARCH_ROW =
  'max-tablet:fixed max-tablet:inset-x-0 max-tablet:top-header max-tablet:flex max-tablet:h-header max-tablet:border-b max-tablet:bg-ink-900 max-tablet:pr-1 max-tablet:pl-4 max-tablet:has-[input:focus-visible]:-outline-offset-3'
// Inside the page, the header is as tall as everything fixed above it. The open search row pushes the page and any
// toolbar stuck under the header down by its own height.
const PAGE_BELOW_SEARCH_ROW = 'max-tablet:[--spacing-header:var(--spacing-header-with-search)]'

export function Shell() {
  const { session } = useRouteContext({ from: '/shell' })
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      void navigate({ to: '/login' })
    },
  })
  const [overlay, setOverlay] = useState<Overlay>(null)
  const drawerOpen = overlay === 'drawer'
  const searchOpen = overlay === 'search'
  const headerRef = useRef<HTMLElement>(null)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  function closeDrawer() {
    setOverlay(null)
    hamburgerRef.current?.focus()
  }

  function closeSearch() {
    setOverlay(null)
    searchToggleRef.current?.focus()
  }

  // While the drawer is open the page can't scroll, and focus stays on the hamburger and the drawer's links.
  useEffect(() => {
    const hamburger = hamburgerRef.current
    const drawer = drawerRef.current
    if (!drawerOpen || !hamburger || !drawer) return undefined
    const root = document.documentElement
    root.classList.add(DRAWER_OPEN_CLASS)
    drawer.querySelector('a')?.focus()

    const close = () => {
      setOverlay(null)
      hamburger.focus()
    }
    // A click on the scrim, or anywhere else outside the drawer and the hamburger, closes it.
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !drawer.contains(event.target) && !hamburger.contains(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        return
      }
      if (event.key !== 'Tab') return
      const stops: HTMLElement[] = [hamburger, ...Array.from(drawer.querySelectorAll('a'))]
      const at = stops.findIndex((stop) => stop === document.activeElement)
      const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length
      event.preventDefault()
      stops[next]?.focus()
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      root.classList.remove(DRAWER_OPEN_CLASS)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [drawerOpen])

  useEffect(() => {
    const header = headerRef.current
    const toggle = searchToggleRef.current
    if (!searchOpen || !header || !toggle) return undefined
    searchInputRef.current?.focus()

    // Focus stays where the click landed, so the tap that dismisses search also reaches what is under it.
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !header.contains(event.target)) setOverlay(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOverlay(null)
      toggle.focus()
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [searchOpen])

  return (
    <div className="min-h-screen bg-ink-950 text-sm text-ink-100">
      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-30 flex h-header items-center gap-2 border-b border-ink-700 bg-ink-900 pr-2 tablet:gap-3 tablet:pr-4"
      >
        <button
          ref={hamburgerRef}
          type="button"
          aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={drawerOpen}
          aria-controls="drawer"
          onClick={() => (drawerOpen ? closeDrawer() : setOverlay('drawer'))}
          className="grid h-header w-rail flex-none place-items-center border-r border-ink-700 hover:bg-ink-800 focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-accent aria-expanded:bg-ink-800"
        >
          <Icon name={drawerOpen ? 'close' : 'menu'} />
        </button>
        <p inert={drawerOpen} className="pl-1 text-xl font-extrabold tracking-tight">
          Continu<span className="text-accent">arr</span>
        </p>
        {/* It searches nothing yet, so typing sends no request. */}
        <div id="search-field" inert={drawerOpen} className={`${SEARCH_FIELD} ${searchOpen ? SEARCH_ROW : 'max-tablet:hidden'}`}>
          <Icon name="search" className="size-3.75" />
          <label htmlFor="search-input" className="sr-only">
            Search
          </label>
          {/* The native clear button is hidden, so the phone row shows one X, the close button. */}
          <input
            ref={searchInputRef}
            id="search-input"
            type="search"
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-ink-100 outline-none placeholder:text-ink-400 max-tablet:h-touch max-tablet:text-base [&::-webkit-search-cancel-button]:appearance-none"
          />
          <button type="button" aria-label="Close search" onClick={closeSearch} className={`${ICON_BUTTON} tablet:hidden`}>
            <Icon name="close" />
          </button>
        </div>
        <div inert={drawerOpen} className="ml-auto flex min-w-0 items-center gap-1 tablet:gap-3">
          <button
            ref={searchToggleRef}
            type="button"
            aria-label="Search"
            aria-expanded={searchOpen}
            aria-controls="search-field"
            onClick={() => setOverlay(searchOpen ? null : 'search')}
            className={`${ICON_BUTTON} tablet:hidden`}
          >
            <Icon name="search" />
          </button>
          {/* A long username truncates, so the search field keeps its width. */}
          <span className="hidden min-w-0 truncate text-ink-400 tablet:inline">{session.username}</span>
          {/* aria-disabled rather than disabled, so a keyboard user's focus stays on the button. Phones show only the icon. */}
          <button
            type="button"
            aria-disabled={mutation.isPending}
            onClick={() => {
              if (!mutation.isPending) mutation.mutate()
            }}
            className="inline-flex size-touch flex-none items-center justify-center gap-1.5 rounded-md border border-transparent font-medium transition not-aria-disabled:hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-85 tablet:h-control tablet:w-auto tablet:border-ink-500 tablet:px-3 tablet:not-aria-disabled:hover:border-ink-400 tablet:not-aria-disabled:hover:bg-transparent"
          >
            <Icon name="logout" className="size-3.75" />
            <span className="max-tablet:sr-only">{mutation.isPending ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </header>
      <NavRail inert={drawerOpen} />
      <div hidden={!drawerOpen} className="fixed inset-x-0 top-header bottom-0 z-40 bg-black/55" />
      <NavDrawer ref={drawerRef} open={drawerOpen} onNavigate={closeDrawer} />
      <main inert={drawerOpen} className={`pt-header tablet:ml-rail ${searchOpen ? PAGE_BELOW_SEARCH_ROW : ''}`}>
        <Outlet />
      </main>
    </div>
  )
}
