import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import appCss from '~/styles/app.css?url'
import { GitBranch, Settings, LayoutDashboard, LogOut } from 'lucide-react'
import { useAuth } from '~/hooks/use-auth'

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
  return (
    <html lang="en">
      <head>
        <HeadContent />
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
        <NavLink to="/repositories" icon={<GitBranch className="h-4 w-4" />}>
          Repositories
        </NavLink>
        <NavLink to="/settings" icon={<Settings className="h-4 w-4" />}>
          Settings
        </NavLink>
      </nav>
      <div className="absolute bottom-0 w-64 border-t p-4">
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
