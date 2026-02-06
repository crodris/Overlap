import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function NotFound() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <a href="/" className="mt-4 inline-block text-sm text-overlap-primary hover:underline">
          Back to dashboard
        </a>
      </div>
    </div>
  )
}

// TanStack Start requires a getRouter export that returns
// a new router instance each time (used for SSR isolation)
export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
