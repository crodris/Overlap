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
import { GitBranch, Settings, LayoutDashboard, LogOut, Moon, Sun, ChevronDown, Menu } from 'lucide-react'
import { useAuth } from '~/hooks/use-auth'
import { useTheme } from '~/hooks/use-theme'
import { api } from '~/lib/api'
import { cn } from '~/lib/utils'
import { Sheet, SheetTrigger, SheetContent } from '~/components/ui/sheet'
import { ToastProvider } from '~/components/ui/toast'
import { Button } from '~/components/ui/button'

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
          <ToastProvider>
            <AppLayout />
          </ToastProvider>
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
      {/* Desktop sidebar - hidden on mobile */}
      <div className="hidden md:block">
        <DesktopSidebar />
      </div>
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile header - shown only on mobile */}
        <MobileHeader />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function MobileHeader() {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="flex md:hidden items-center justify-between border-b px-4 py-3">
      <Link to="/" className="flex items-center gap-2 font-semibold">
        <GitBranch className="h-5 w-5 text-overlap-primary" />
        <span className="text-lg">Overlap</span>
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation menu">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

function DesktopSidebar() {
  return (
    <aside className="sticky top-0 h-screen w-64 border-r bg-card">
      <SidebarContent />
    </aside>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
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
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold" onClick={onNavigate}>
          <GitBranch className="h-6 w-6 text-overlap-primary" />
          <span className="text-xl">Overlap</span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        <NavLink to="/" icon={<LayoutDashboard className="h-4 w-4" />} onClick={onNavigate}>
          Dashboard
        </NavLink>

        {/* Repositories accordion */}
        <div>
          <div className="flex items-center">
            <Link
              to="/repositories"
              onClick={onNavigate}
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
              aria-label={reposExpanded ? 'Collapse repositories list' : 'Expand repositories list'}
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
                    onClick={onNavigate}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    activeProps={{
                      className: 'bg-accent text-accent-foreground',
                    }}
                  >
                    <span className="truncate" title={repo.fullName}>{repoName}</span>
                    <span
                      className={cn(
                        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium text-white',
                        repo.activeOverlaps > 0 ? 'bg-destructive' : 'bg-secondary text-secondary-foreground',
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

        <NavLink to="/settings" icon={<Settings className="h-4 w-4" />} onClick={onNavigate}>
          Settings
        </NavLink>
      </nav>
      <div className="border-t p-4 space-y-1">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
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
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </div>
  )
}

function NavLink({
  to,
  icon,
  children,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
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
