import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import * as React from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import appCss from '~/styles/app.css?url'
import { GitBranch, Settings, LayoutDashboard, LogOut, Moon, Sun, ChevronDown } from 'lucide-react'
import { useAuth } from '~/hooks/use-auth'
import { useTheme } from '~/hooks/use-theme'
import { api } from '~/lib/api'
import { cn } from '~/lib/utils'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
})

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Overlap - Detect Branch Conflicts Early' },
      {
        name: 'description',
        content: 'Detect overlapping file changes across active Git branches in real time',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { theme } = useTheme()

  return (
    <html lang="en" className={theme === 'dark' ? 'dark' : ''} suppressHydrationWarning>
      <head>
        <HeadContent />
        <script src="/theme-init.js" />
      </head>
      <body className="min-h-screen bg-background antialiased">
        <QueryClientProvider client={queryClient}>
          <AppLayout />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function AppLayout() {
  const routerState = useRouterState()
  const isLoginPage = routerState.location.pathname === '/login'

  if (isLoginPage) {
    return <Outlet />
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function Sidebar() {
  const { logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [reposExpanded, setReposExpanded] = React.useState(true)
  const routerState = useRouterState()
  const isReposActive = routerState.location.pathname.startsWith('/repositories')

  const { data: repositories } = useQuery({
    queryKey: ['repositories'],
    queryFn: api.getRepositories,
  })

  return (
    <aside className="sticky top-0 h-screen w-64 border-r bg-card relative">
      <div className="flex h-16 items-center border-b px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <GitBranch className="h-6 w-6 text-overlap-primary" />
          <span className="text-xl">Overlap</span>
        </Link>
      </div>
      <nav className="space-y-1 p-4">
        <NavLink to="/" icon={<LayoutDashboard className="h-4 w-4" />}>
          Dashboard
        </NavLink>

        {/* Repositories accordion */}
        <div>
          <div className="flex items-center">
            <Link
              to="/repositories"
              className={cn(
                'flex flex-1 items-center gap-3 rounded-md rounded-r-none px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isReposActive && 'bg-accent text-accent-foreground',
              )}
            >
              <GitBranch className="h-4 w-4" />
              Repositories
            </Link>
            <button
              onClick={() => setReposExpanded((prev) => !prev)}
              className={cn(
                'rounded-md rounded-l-none px-2 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isReposActive && 'bg-accent text-accent-foreground',
              )}
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  !reposExpanded && '-rotate-90',
                )}
              />
            </button>
          </div>

          {reposExpanded && repositories && repositories.length > 0 && (
            <div className="ml-6 mt-1 space-y-0.5 border-l pl-3">
              {repositories.map((repo) => {
                const repoName = repo.fullName.split('/').pop() ?? repo.fullName
                return (
                  <Link
                    key={repo.id}
                    to="/repositories/$repoId"
                    params={{ repoId: repo.id }}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    activeProps={{
                      className: 'bg-accent text-accent-foreground',
                    }}
                  >
                    <span className="truncate">{repoName}</span>
                    <span
                      className={cn(
                        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium text-white',
                        repo.activeOverlaps > 0 ? 'bg-destructive' : 'bg-black dark:bg-zinc-700',
                      )}
                    >
                      {repo.activeOverlaps}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <NavLink to="/settings" icon={<Settings className="h-4 w-4" />}>
          Settings
        </NavLink>
      </nav>
      <div className="absolute bottom-0 w-64 border-t p-4 space-y-1">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}

function NavLink({
  to,
  icon,
  children,
}: {
  to: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      activeProps={{
        className: 'bg-accent text-accent-foreground',
      }}
      activeOptions={{ exact: to === '/' }}
    >
      {icon}
      {children}
    </Link>
  )
}
