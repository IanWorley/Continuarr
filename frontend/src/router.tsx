import { createRootRoute, createRouter } from '@tanstack/react-router'

// Placeholder until the login, setup, and shell pages land (#9).
const rootRoute = createRootRoute({
  component: () => <p>Continuarr</p>,
})

export const router = createRouter({ routeTree: rootRoute })

// Registers the router type so links and navigation are type-checked app-wide.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
