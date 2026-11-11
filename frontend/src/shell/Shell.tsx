import { useMutation } from '@tanstack/react-query'
import { Outlet, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { logout } from '../api/client.ts'
import { Icon } from './Icon.tsx'
import { NavDrawer, NavRail } from './nav.tsx'

const DRAWER_OPEN_CLASS = 'drawer-open'

export function Shell() {
  const { session } = useRouteContext({ from: '/shell' })
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      void navigate({ to: '/login' })
    },
  })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  function closeDrawer() {
    setDrawerOpen(false)
    hamburgerRef.current?.focus()
  }

  // While the drawer is open the page can't scroll, and focus stays on the hamburger and the drawer's links.
  useEffect(() => {
    const hamburger = hamburgerRef.current
    const drawer = drawerRef.current
    if (!drawerOpen || !hamburger || !drawer) return undefined
    const root = document.documentElement
    root.classList.add(DRAWER_OPEN_CLASS)
    drawer.querySelector('a')?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        hamburger.focus()
        return
      }
      if (event.key !== 'Tab') return
      const stops: HTMLElement[] = [hamburger, ...Array.from(drawer.querySelectorAll('a'))]
      const at = stops.findIndex((stop) => stop === document.activeElement)
      const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length
      event.preventDefault()
      stops[next]?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      root.classList.remove(DRAWER_OPEN_CLASS)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [drawerOpen])

  return (
    <div className="min-h-screen bg-ink-950 text-sm text-ink-100">
      <header className="fixed inset-x-0 top-0 z-30 flex h-header items-center gap-2 border-b border-ink-700 bg-ink-900 pr-2 tablet:gap-3 tablet:pr-4">
        <button
          ref={hamburgerRef}
          type="button"
          aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={drawerOpen}
          aria-controls="drawer"
          onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
          className="grid h-header w-rail flex-none place-items-center border-r border-ink-700 hover:bg-ink-800 focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-accent aria-expanded:bg-ink-800"
        >
          <Icon name={drawerOpen ? 'close' : 'menu'} />
        </button>
        <p inert={drawerOpen} className="pl-1 text-xl font-extrabold tracking-tight">
          Continu<span className="text-accent">arr</span>
        </p>
        <div inert={drawerOpen} className="ml-auto flex items-center gap-1 tablet:gap-3">
          <span className="hidden text-ink-400 tablet:inline">{session.username}</span>
          {/* aria-disabled rather than disabled, so a keyboard user's focus stays on the button. Phones show only the icon. */}
          <button
            type="button"
            aria-disabled={mutation.isPending}
            onClick={() => {
              if (!mutation.isPending) mutation.mutate()
            }}
            className="inline-flex size-touch items-center justify-center gap-1.5 rounded-md border border-transparent font-medium transition not-aria-disabled:hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-85 tablet:h-control tablet:w-auto tablet:border-ink-500 tablet:px-3 tablet:not-aria-disabled:hover:border-ink-400 tablet:not-aria-disabled:hover:bg-transparent"
          >
            <Icon name="logout" className="size-3.75" />
            <span className="max-tablet:sr-only">{mutation.isPending ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </header>
      <NavRail inert={drawerOpen} />
      {/* Covers the page below the header. A click on it closes the drawer, and Escape does the same from the keyboard. */}
      <div hidden={!drawerOpen} onClick={closeDrawer} className="fixed inset-x-0 top-header bottom-0 z-40 bg-black/55" />
      <NavDrawer ref={drawerRef} open={drawerOpen} onNavigate={closeDrawer} />
      <main inert={drawerOpen} className="pt-header tablet:ml-rail">
        <Outlet />
      </main>
    </div>
  )
}
