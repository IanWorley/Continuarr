import { useMutation } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useRouteContext } from '@tanstack/react-router'
import { logout } from '../api/client.ts'

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
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <header className="flex items-center gap-4 border-b border-ink-700 px-6 py-4">
        <p className="text-xl font-extrabold tracking-tight">
          Continu<span className="text-accent">arr</span>
        </p>
        {/* Link marks the current page with aria-current="page". */}
        <nav aria-label="Main">
          <Link
            to="/settings"
            className="rounded-md px-2 py-1 text-sm text-ink-400 transition hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent aria-[current=page]:text-ink-100"
          >
            Settings
          </Link>
        </nav>
        <span className="ml-auto text-sm text-ink-400">{session.username}</span>
        {/* aria-disabled rather than disabled, so a keyboard user's focus stays on the button. */}
        <button
          type="button"
          aria-disabled={mutation.isPending}
          onClick={() => {
            if (!mutation.isPending) mutation.mutate()
          }}
          className="rounded-md border border-ink-500 px-3 py-1.5 text-sm font-medium transition not-aria-disabled:hover:border-ink-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-85"
        >
          {mutation.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
