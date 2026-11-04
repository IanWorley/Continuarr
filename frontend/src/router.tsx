import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { fetchSetupStatus } from './api/client.ts'
import { LoginPage } from './login/LoginPage.tsx'
import { SetupPage } from './setup/SetupPage.tsx'

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

// Placeholder until the logged-in shell lands (#9).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => redirectWhen(true, '/setup'),
  component: () => <p>Continuarr</p>,
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

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, loginRoute, setupRoute]) })

// Registers the router type so links and navigation are type-checked app-wide.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
