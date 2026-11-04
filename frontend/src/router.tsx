import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { fetchSession, fetchSetupStatus } from './api/client.ts'
import { LoginPage } from './login/LoginPage.tsx'
import { SetupPage } from './setup/SetupPage.tsx'
import { Shell } from './shell/Shell.tsx'

const rootRoute = createRootRoute()

/**
 * Sends the visitor to `to` when setup's status is `setupRequired`. Asked on every visit rather
 * than cached, since creating the admin flips it. If the server can't answer, the visitor stays
 * put and the page's own submit reports the outage.
 */
async function redirectWhen(setupRequired: boolean, to: '/login' | '/setup'): Promise<void> {
  const status = await fetchSetupStatus().catch(() => undefined)
  if (status?.required === setupRequired) throw redirect({ to })
}

// Signed-in pages nest under the shell. It skips the setup check, since /login's own check sends a
// fresh install on to /setup.
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  beforeLoad: async () => {
    const session = await fetchSession().catch(() => undefined)
    if (!session) throw redirect({ to: '/login' })
    return { session }
  },
  component: Shell,
})

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => redirectWhen(true, '/setup'),
  component: LoginPage,
})

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: () => redirectWhen(false, '/login'),
  component: SetupPage,
})

export const routeTree = rootRoute.addChildren([shellRoute.addChildren([indexRoute]), loginRoute, setupRoute])

export const router = createRouter({ routeTree })

// Registers the router type so links and navigation are type-checked app-wide.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
