import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { LoginPage } from './login/LoginPage.tsx'

const rootRoute = createRootRoute({ component: Outlet })

// Placeholder until the logged-in shell lands (#9).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <p>Continuarr</p>,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, loginRoute]) })

// Registers the router type so links and navigation are type-checked app-wide.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
