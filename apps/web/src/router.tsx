import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// TanStack Start requires a getRouter export that returns
// a new router instance each time (used for SSR isolation)
export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
