import { useMutation } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useRouteContext } from '@tanstack/react-router'
import { logout } from '../api/client.ts'
import { isBuilt, SETTINGS_SECTIONS } from '../settings/settingsSections.ts'

const NAV_LINK_CLASSES =
  'block rounded-md px-3 py-1.5 text-sm text-ink-400 transition hover:bg-ink-900 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent aria-[current=page]:bg-ink-900 aria-[current=page]:font-medium aria-[current=page]:text-ink-100'

export function Shell() {
  const { session } = useRouteContext({ from: '/shell' })
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      void navigate({ to: '/login' })
    },
  })

  return (
    <div className="flex min-h-screen bg-ink-900 text-ink-100">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-ink-700 bg-ink-950 px-3 py-5">
        <p className="px-3 text-xl font-extrabold tracking-tight">
          Continu<span className="text-accent">arr</span>
        </p>
        {/* Link marks the current page with aria-current="page". Exact matching keeps Settings from
            claiming a sub-page as its own. */}
        <nav aria-label="Main" className="mt-8 flex-1 overflow-y-auto">
          <Link to="/settings" activeOptions={{ exact: true }} className={NAV_LINK_CLASSES}>
            Settings
          </Link>
          <ul className="mt-1 ml-3 border-l border-ink-700 pl-2">
            {SETTINGS_SECTIONS.filter(isBuilt).map((section) => (
              <li key={section.to}>
                <Link to={section.to} className={NAV_LINK_CLASSES}>
                  {section.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-ink-700 px-3 pt-4">
          <p className="truncate text-sm text-ink-400">{session.username}</p>
          {/* aria-disabled rather than disabled, so a keyboard user's focus stays on the button. */}
          <button
            type="button"
            aria-disabled={mutation.isPending}
            onClick={() => {
              if (!mutation.isPending) mutation.mutate()
            }}
            className="mt-3 w-full rounded-md border border-ink-500 px-3 py-1.5 text-sm font-medium transition not-aria-disabled:hover:border-ink-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-85"
          >
            {mutation.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
